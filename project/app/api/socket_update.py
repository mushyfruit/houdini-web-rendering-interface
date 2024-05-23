import os
import json
import uuid
from flask import request, current_app

from app import socketio, redis_client, constants as cnst
from app.api import hou_api, utils

logger = utils.get_logger("celery_listener")


@socketio.on('submit_render_task')
def receive_render_task(render_data):
    socket_id = request.sid
    start = render_data.get('start')
    end = render_data.get('end')
    step = render_data.get('step')
    node_path = render_data.get('path')

    # Can't rely on session object for file_uuid as if HTTP route
    # make change to session, it doesn't seem to update WebSocket connection.
    # Instead, pass the file_uuid via the NodeGraphManager.
    file_uuid = render_data.get('file')

    try:
        if not node_path:
            raise ValueError("Invalid submission node provided.")

        render_id, glb_path, thumbnail_path = generate_uuid_filepath("glb")
        if render_id is None:
            raise ValueError("Unable to construct a valid UUID for render.")

        render_struct = cnst.RenderTaskStruct(node_path=node_path,
                                              glb_path=glb_path,
                                              thumbnail_path=thumbnail_path,
                                              start=start,
                                              end=end,
                                              step=step,
                                              file_uuid=file_uuid,
                                              socket_id=socket_id)
        logger.info(render_struct)
        result = hou_api.submit_node_for_render(render_struct)
        if not result:
            raise RuntimeError("Render submission failed.")
    except Exception as e:
        error_message = str(e)
        return {"message": error_message, "success": False}

    # SocketIO will handle the serialization to JSON.
    return {
        "message": "Submission succeeded.",
        "filename": str(render_id),
        "success": True
    }


def listen_to_celery_workers():
    """Create a redis client subscribed to the channels on which
    the celery workers will publish their updates.

    Render updates received over the `render_updates` channel are
    then emitted over a WebSocket to update the popper's progress
    bar.

    Completion notifications received over `render_completion_channel`
    will indicate to the user that model is being loaded in Babylon.
    """
    _redis_client = redis_client.get_client_instance()
    pubsub = _redis_client.pubsub()
    pubsub.subscribe(cnst.PublishChannels.render_completion,
                     cnst.PublishChannels.glb_progress,
                     cnst.PublishChannels.thumb_progress)

    channel_handlers = {
        cnst.PublishChannels.render_completion: handle_render_completion,
        cnst.PublishChannels.glb_progress: handle_glb_progress_update,
        cnst.PublishChannels.thumb_progress: handle_thumb_progress_update,
    }

    for message in pubsub.listen():
        if message['type'] != 'message':
            continue

        channel = message['channel'].decode('utf-8')
        message_data = message['data'].decode('utf-8')

        if not message_data:
            logger.error("No message data provided "
                         "for update: {0}".format(channel))
            return

        if channel in channel_handlers:
            channel_handlers[channel](message_data)
        else:
            logger.error("Invalid channel name: {0}".format(channel))


def handle_render_completion(message_data):
    render_completion_data = json.loads(message_data)

    required_keys = {
        'file_uuid', 'render_type', 'render_node_path',
        'render_file_path', 'socket_id', 'frame_info',
    }
    if not validate_required_keys(render_completion_data, required_keys):
        return

    render_type = render_completion_data["render_type"]
    if render_type == cnst.BackgroundRenderType.glb_file:
        channel = cnst.PublishChannels.node_render_finished
    elif render_type == cnst.BackgroundRenderType.thumbnail:
        channel = cnst.PublishChannels.node_thumb_finished
    else:
        logger.error("Unknown render type: {0}".format(render_type))
        return

    filename = render_completion_data["render_file_path"].split(os.sep)[-1]

    formatted_frame_string = None
    if render_type == cnst.BackgroundRenderType.glb_file:
        frames = render_completion_data["frame_info"]
        formatted_frame_string = "{0}-{1}".format(frames[0], frames[1])

    redis_client.store_render_data(render_type,
                                   render_completion_data["file_uuid"],
                                   filename,
                                   render_completion_data["render_node_path"],
                                   formatted_frame_string)

    # TODO
    print({
        'hipFile': render_completion_data["file_uuid"],
        'fileName': filename,
        'nodePath': render_completion_data["render_node_path"]
    })

    render_completion_dict = {
        'hipFile': render_completion_data["file_uuid"],
        'fileName': filename,
        'nodePath': render_completion_data["render_node_path"],
    }

    if render_type == cnst.BackgroundRenderType.glb_file:
        render_completion_dict["frameRange"] = render_completion_data["frame_info"]

    socketio.emit(channel, render_completion_dict, room=render_completion_data["socket_id"])


def handle_glb_progress_update(message_data):
    glb_progress_data = json.loads(message_data)

    required_keys = {'render_node_path', 'progress', "socket_id"}
    if not validate_required_keys(glb_progress_data, required_keys):
        return

    socketio.emit(cnst.PublishChannels.node_render_update, {
        'nodePath': glb_progress_data['render_node_path'],
        'progress': glb_progress_data['progress']
    },
                  room=glb_progress_data["socket_id"])


def handle_thumb_progress_update(message_data):
    thumb_data = json.loads(message_data)

    required_keys = {'nodePath', 'progress', "socket_id"}
    if not validate_required_keys(thumb_data, required_keys):
        return

    socketio.emit(cnst.PublishChannels.node_thumb_update, {
        'nodePath': thumb_data["nodePath"],
        'progress': float(thumb_data["progress"])
    },
                  room=thumb_data["socket_id"])


def validate_required_keys(data, keys):
    if not keys.issubset(data):
        logger.error("Missing required data in message: {0}".format(str(keys)))
        return False
    return True


def generate_uuid_filepath(glb_suffix):
    """Core function for determining the output paths for the glb file and associated
    png thumbnail.

    The default config value for the static folder is overriden to /var/model_storage,
    so that nginx can more efficiently serve the user generated data.

    :param glb_suffix: Suffix of the glb file
    :type glb_suffix: str
    :returns: Tuple containing the render UUID, the glb render path, and the thumbnail path.
    :rtype: tuple(str, str, str)
    """
    if glb_suffix not in ["glb", "gltf"]:
        logger.error("Invalid suffix provided: {0}".format(glb_suffix))
        return None, None, None

    glb_dir = os.path.join(current_app.static_folder, current_app.config["MODEL_DIR"])
    png_dir = os.path.join(current_app.static_folder, current_app.config["THUMBNAIL_DIR"])

    render_id = uuid.uuid4()
    render_name = "{0}.{1}".format(render_id, glb_suffix)
    thumbnail_name = "{0}.{1}".format(render_id, cnst.THUMBNAIL_EXT)

    glb_render_path = os.path.join(glb_dir, render_name)
    thumbnail_path = os.path.join(png_dir, thumbnail_name)

    return render_id, glb_render_path, thumbnail_path
