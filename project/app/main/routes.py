import os
import glob
import uuid

from app import redis_client
from app.main import bp
from app.api import hou_api
from app.constants import CURRENT_FILE_UUID
from flask import (current_app, render_template,
                   send_file, jsonify, request, session, send_from_directory)
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


@bp.route("/get_thumbnail/<filename>", methods=['GET'])
def get_thumbnail(filename):
    if not filename.endswith(".png"):
        filename += ".glb"

    static_directory = os.path.join(current_app.static_folder, 'temp')
    return send_from_directory(static_directory, filename)


@bp.route("/get_glb/<filename>", methods=['GET'])
def get_glb_file(filename):
    if not filename.endswith(".glb"):
        render_id = filename
        filename = render_id + ".glb"

    # Separate logic for placeholder model.
    if filename == current_app.config['PLACEHOLDER_FILE']:
        placeholder_dir = os.path.join(current_app.static_folder,
                                       current_app.config['PLACEHOLDER_DIR'])
        glb_file_path = os.path.join(placeholder_dir, filename)
    else:
        glb_file_path = os.path.join(current_app.static_folder, 'temp',
                                     filename)

    # Send the GLTF file as a response
    if not os.path.exists(glb_file_path):
        print("{0} does not exist on disk.".format(glb_file_path))
        return jsonify({"error": "Requested an invalid .glb file."}), 400

    return send_file(glb_file_path,
                     mimetype='application/gltf+json',
                     as_attachment=True,
                     download_name='model.gltf',
                     etag=False,
                     max_age=0,
                     conditional=False)


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
    print(stored_model_data)
    if stored_model_data:
        return jsonify({'model_data': stored_model_data})
    else:
        return jsonify({"message": "Invalid model data. Specify a key."}), 400


def allowed_hip(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in current_app.config["ALLOWED_EXTENSIONS"]
