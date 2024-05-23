import re
import os
import glob
import uuid
from nanoid import generate

from app import redis_client
from app.main import bp
from app.api import hou_api
from app.constants import CURRENT_FILE_UUID
from flask import (current_app, render_template,
                   url_for, redirect, jsonify, request, session, send_from_directory)
from werkzeug.utils import secure_filename


@bp.route('/', methods=['GET', 'POST'])
@bp.route('/index', methods=['GET', 'POST'])
def index():
    # Store a session id to manage web sockets.
    if "session_id" not in session:
        session["session_id"] = str(uuid.uuid4())
    return render_template('index.html')


@bp.route("/generate_user_uuid", methods=["GET"])
def generate_user_uuid():
    user_uuid = str(uuid.uuid4())
    session["user_uuid"] = user_uuid
    return jsonify(user_uuid=user_uuid)


@bp.route("/get_nano_id", methods=["GET"])
def generate_nano_id():
    filename = request.args.get('filename')
    if not filename:
        return jsonify({
            "error": "No filename was provided for nano id generation request."
        }), 400

    # Could increase to avoid collision probability.
    stored_nano_id = redis_client.has_generated_nanoid(filename)
    if stored_nano_id is None:
        nano_id = generate(size=10)
        redis_client.add_shareable_mapping(nano_id, filename)
        stored_nano_id = nano_id
    return jsonify({"nano_id": stored_nano_id}), 200


@bp.route("/get_glb_from_nano/<nano_id>", methods=["GET"])
def retrieve_file_from_nano_id(nano_id):
    if nano_id.endswith(".glb") or nano_id.endswith(".gltf"):
        pattern = re.compile(r'\.glb$|\.gltf$', re.IGNORECASE)
        nano_id = re.sub(pattern, '', nano_id)

    filename = redis_client.get_filename_for_nanoid(nano_id)
    if filename is None:
        print(f"No filename found for nano_id: {nano_id}")
        return jsonify({"error": "Filename not found for the given nano_id."}), 404

    return get_glb_file(filename)


@bp.route('/view', methods=['GET'])
def view():
    # Store a session id to manage web sockets.
    if "session_id" not in session:
        session["session_id"] = str(uuid.uuid4())
    return render_template('index.html')


@bp.route("/set_existing_user_uuid", methods=["POST"])
def set_existing_user_uuid():
    data = request.get_json()
    user_uuid = data.get('userUuid')

    if user_uuid:
        print("Setting existing session user ID to {}".format(user_uuid))
        session["user_uuid"] = user_uuid
        return jsonify({'status': 'success', 'message': 'UUID set in session'}), 200
    else:
        return jsonify({'status': 'error', 'message': 'No UUID provided'}), 400


@bp.route("/get_glb/<filename>", methods=['GET'])
def get_glb_file(filename):
    if not filename.endswith(".glb"):
        return jsonify({"error": "Invalid file type requested."}), 400

    # If not using nginx, call `send_file` with flask to send the .glb

    # Redirect the requst to nginx.
    model_folder = current_app.config["MODEL_DIR"]
    glb_url = url_for('static', filename='{0}/{1}'.format(model_folder, filename))
    return redirect(glb_url, code=302)


@bp.route("/node_data", methods=['GET'])
def graph_data():
    """Process the .hip file and return a dictionary for CytoscapeJS.

    :returns: Dictionary to populate CytoscapeJS nodes and poppers.
    :rtype: dict
    """
    file_uuid = request.args.get('uuid')
    parent_node = request.args.get('name')

    if not file_uuid:
        return jsonify({"error": "A file UUID is required."}), 400

    # Avoid calling hou.hipFile.load if we've already loaded.
    if file_uuid == session.get(CURRENT_FILE_UUID, None):
        node_data = hou_api.scan_and_display_nodes(parent_node, load=False)
        return jsonify(node_data), 200

    # Locate the file on disk. Search for UUID prefix.
    # Handles searching for .hip, .hiplc, and .hipnc files.
    search_pattern = os.path.join(current_app.config['UPLOAD_FOLDER'],
                                  "{0}.hip*".format(file_uuid))

    matching_files = glob.glob(search_pattern)
    if not matching_files:
        return jsonify({"error": "No matching files with provided UUID."}), 400

    if len(matching_files) > 1:
        # Potentially indicates need for cleanup or strange collision issue.
        return jsonify({"error": "Multiple files found."}), 500

    hip_file = matching_files[0]
    node_data = hou_api.scan_and_display_nodes(parent_node, hip_file=hip_file)

    # Store the current file UUID for later use when storing render data in redis.
    session[CURRENT_FILE_UUID] = file_uuid

    # Store UUID for socketIO room.
    if "session_id" not in session:
        session["session_id"] = str(uuid.uuid4())
    node_data["session_id"] = session["session_id"]
    return jsonify(node_data), 200


# Serve the base html structure.
@bp.route("/node_graph", methods=['GET'])
def get_node_graph():
    return render_template('node_graph.html'), 200


@bp.route("/stored_models", methods=['GET'])
def get_stored_models():
    return render_template('stored_models.html'), 200


# hwebserver.registerWSGIApp doesn't support multipart form requests.
# Avoid using that as backend.
@bp.route("/hip_upload", methods=['POST'])
def handle_upload():
    if 'hipfile' not in request.files:
        return jsonify({"message": "No hip file was contained."}), 400

    hip_file = request.files['hipfile']

    if hip_file.filename == "":
        return jsonify({"message": "No file was selected."}), 400

    if hip_file and allowed_hip(hip_file.filename):
        sanitized_filename = secure_filename(hip_file.filename)
        _, ext = os.path.splitext(sanitized_filename)
        file_uuid = str(uuid.uuid4())
        filename = "{0}{1}".format(file_uuid, ext)

        if 'uploaded_files' not in session:
            session['uploaded_files'] = []

        session['uploaded_files'].append(file_uuid)

        # Store user's uploaded .hip file name in redis instance.
        is_unique_hip, file_hash = redis_client.add_unique_filename(
            session["user_uuid"], sanitized_filename, file_uuid, hip_file)

        if is_unique_hip:
            file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
            hip_file.save(file_path)
        else:
            # File has already been saved for the user. Find that and return the file uuid.
            file_uuid = redis_client.retrieve_uuid_from_filename(session["user_uuid"], file_hash)

            # This can be None if the file never rendered anything, but had an entry made.
            if file_uuid is None:
                return jsonify({"message": "File hash matched, but unable to retrieve file."}), 400
            print("Located existing file with matching hash for: {0}".format(sanitized_filename))

        return jsonify({
            "uuid": file_uuid,
            "message": "File upload successful."
        }), 200
    else:
        return jsonify({"message": "File type not allowed"}), 400


@bp.route('/get_stored_models', methods=['GET'])
def retrieve_stored_models():
    user_uuid = request.args.get('userUuid')
    if not user_uuid:
        return jsonify({"message": "Invalid request. Specify a user_uuid."}), 400

    stored_model_data = redis_client.get_user_uploaded_file_dicts(user_uuid)
    if stored_model_data:
        return jsonify({'model_data': stored_model_data})
    else:
        return jsonify({"message": "Invalid model data. Specify a key."}), 400


def allowed_hip(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in current_app.config["ALLOWED_EXTENSIONS"]


#############################################################################
# Unused routes for static files that nginx directly serves.

@bp.route("/_get_thumbnail/<filename>", methods=['GET'])
def get_thumbnail(filename):
    if not filename.endswith(".glb"):
        return jsonify({"error": "Invalid file type requested."}), 400

    static_directory = os.path.join(current_app.static_folder, 'user_thumbnails')
    return send_from_directory(static_directory, filename)
