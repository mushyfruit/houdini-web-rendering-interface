import re
import os
import glob
import uuid
import time
import zipfile
from nanoid import generate

from app import redis_client
from app.main import bp
from app.api import hou_api
from app.constants import CURRENT_FILE_UUID
from flask import (current_app, render_template,
                   url_for, redirect, jsonify, request,
                   session, send_from_directory, send_file)
from werkzeug.utils import secure_filename

temporary_links = {}


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


@bp.route('/generate_download', methods=["GET"])
def generate_download_link():
    filename = request.args.get('filename')
    file_ext = request.args.get('ext')
    if not filename:
        return jsonify({
            "error": "No filename was provided for download generation request."
        }), 400

    download_id = str(uuid.uuid4())
    expiry_time = time.time() + 3600
    temporary_links[download_id] = (filename, expiry_time)
    return jsonify(download_link=f"/download/{file_ext}/{download_id}")


@bp.route('/download/<ext>/<download_id>', methods=['GET'])
def download_glb_file(ext, download_id):
    if ext not in ('glb', 'hip'):
        return jsonify({
            "error": "Invalid download extension provided."
        }), 400

    if download_id not in temporary_links:
        return jsonify({
            "error": "Invalid download link provided."
        }), 400

    filename, expiry_time = temporary_links[download_id]
    if time.time() >= expiry_time:
        return jsonify({
            "error": "Download link expired!"
        }), 400

    if ext == "glb":
        mimetype = 'model/gltf-binary'
        directory_path = f"{current_app.config['STATIC_FOLDER']}/{current_app.config['MODEL_DIR']}"
    else:
        mimetype = 'application/octet-stream'
        directory_path = current_app.config['UPLOAD_FOLDER']
        if 'hip' not in filename:
            # Hip UUID's are stored without file extension (.hip, .hiplc, .hipnc)
            # Retrieve the file extension based on the redis entry.
            original_name = redis_client.get_hip_name_from_uuid(filename)
            if original_name:
                filename += os.path.splitext(original_name)[1]

    if os.path.exists(os.path.join(directory_path, filename)):
        return send_from_directory(directory_path,
                                   filename,
                                   download_name=generate_download_name(filename, ext) or filename,
                                   as_attachment=True,
                                   mimetype=mimetype)

    placeholder_path = f"{current_app.config['STATIC_FOLDER']}/{current_app.config['PLACEHOLDER_DIR']}"
    if os.path.exists(os.path.join(placeholder_path, filename)):
        return send_from_directory(placeholder_path,
                                   filename,
                                   as_attachment=True,
                                   mimetype=mimetype)

    return jsonify({
        "error": "File does not exist!"
    }), 404


@bp.route("/get_nano_id", methods=["GET"])
def generate_nano_id():
    filename = request.args.get('filename')
    is_placeholder = request.args.get('is_placeholder') == 'true'
    if not filename:
        return jsonify({
            "error": "No filename was provided for nano id generation request."
        }), 400

    # Could increase to avoid collision probability.
    stored_nano_id = redis_client.has_generated_nanoid(filename)
    if stored_nano_id is None:
        nano_id = generate(size=10)
        redis_client.add_shareable_mapping(nano_id, filename)
        if is_placeholder:
            redis_client.add_placeholder_mapping(filename)
        stored_nano_id = nano_id
    return jsonify({"nano_id": stored_nano_id}), 200


@bp.route("/get_glb_from_nano/<nano_id>", methods=["GET"])
def retrieve_file_from_nano_id(nano_id, redirect_request=True):
    if nano_id.endswith(".glb") or nano_id.endswith(".gltf"):
        pattern = re.compile(r'\.glb$|\.gltf$', re.IGNORECASE)
        nano_id = re.sub(pattern, '', nano_id)

    filename = redis_client.get_filename_for_nanoid(nano_id)
    if filename is None:
        if not redirect_request:
            return None
        print(f"No filename found for nano_id: {nano_id}")
        return jsonify({"error": "Filename not found for the given nano_id."}), 404

    if redirect_request:
        return get_glb_file(filename)
    else:
        return filename


@bp.route("/download_rendered_sequence_zip", methods=["GET"])
def download_rendered_sequence_zip():
    filename = request.args.get('filename')
    if not filename:
        return jsonify({"message": "No valid filename was provided to download."}), 400

    file_uuid = filename.split(".")[0]
    directory = os.path.join(current_app.config['USER_RENDER_DIR'], file_uuid)

    files = glob.glob(os.path.join(directory, '*'))
    zip_path = os.path.join(directory, "{0}.zip".format(file_uuid))
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for file in files:
            zipf.write(file, os.path.basename(file))

    return send_file(zip_path, as_attachment=True)


@bp.route("/get_file_uuid_from_nano", methods=["GET"])
def get_file_uuid_from_nano():
    nano_id = request.args.get('nanoid')
    if not nano_id:
        return jsonify({"message": "No valid nano id was passed."}), 400

    if nano_id == current_app.config["PLACEHOLDER_FILE"]:
        return jsonify({'file_uuid': current_app.config["PLACEHOLDER_FILE"]}), 200

    # Find the associated file uuid mapped to the nano id.
    filename = retrieve_file_from_nano_id(nano_id, redirect_request=False)
    if filename is None:
        return jsonify({"message": "No valid file uuid was mapped "
                                   "to nano id: {0}.".format(nano_id)}), 400

    return jsonify({'file_uuid': filename})


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
        if file_uuid == current_app.config["PLACEHOLDER_DIR"]:
            # Make an exception if we're attempting to load placeholder.hip
            matching_files = [current_app.config["PLACEHOLDER_HIP_PATH"]]
        else:
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
        return jsonify({'model_data': stored_model_data}), 200
    else:
        return jsonify({"message": "Empty model data! No associated user renders."}), 200


@bp.route('/get_hip_name_from_nano_id', methods=['GET'])
def hip_file_name_from_nanoid():
    # Retrieve the nano id request argument.
    nano_id = request.args.get('nanoid')
    if not nano_id:
        return jsonify({"message": "No valid nano id was passed."}), 400

    # Find the associated file uuid mapped to the nano id.
    filename = retrieve_file_from_nano_id(nano_id, redirect_request=False)
    if filename is None:
        return jsonify({"message": "No valid file uuid was mapped "
                                   "to nano id: {0}.".format(nano_id)}), 400

    hip_uuid = redis_client.retrieve_hip_uuid_from_filename(filename)
    if hip_uuid:
        return jsonify({'hip_uuid': hip_uuid})

    return jsonify({"message": "Invalid filename. No linked hip file found."}), 400


def allowed_hip(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in current_app.config["ALLOWED_EXTENSIONS"]


def generate_download_name(filename, ext):
    if ext == 'glb':
        hip_name = redis_client.get_hip_original_name_from_filename(filename)
    else:
        filename_base = os.path.splitext(filename)[0]
        hip_name = redis_client.get_hip_name_from_uuid(filename_base)

    if hip_name is not None:
        # Remove the file extension.
        hip_name, _ = os.path.splitext(hip_name)
        return f"{hip_name}.{ext}"


#############################################################################
# Unused routes for static files that nginx directly serves.

@bp.route("/_get_thumbnail/<filename>", methods=['GET'])
def get_thumbnail(filename):
    if not filename.endswith(".glb"):
        return jsonify({"error": "Invalid file type requested."}), 400

    static_directory = os.path.join(current_app.static_folder, 'user_thumbnails')
    return send_from_directory(static_directory, filename)
