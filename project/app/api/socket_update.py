import os
import json
import uuid
from flask import request, current_app, session

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
                                              user_uuid=session[cnst.CURRENT_FILE_UUID],
                                              socket_id=socket_id)
        logger.info(render_struct)
        result = hou_api.submit_node_for_render(render_struct)
        if not result:
            raise RuntimeError("Render submission failed.")
    except Exception as e:
        error_message = str(e)
        return {"message": error_message, "success": False}

    session.setdefault('rendered_filenames', {})[render_id] = glb_path
    # Ensure the nested dict is maintained in session obj.
    session.modified = True

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
        'user_uuid', 'render_type', 'render_node_path',
        'render_file_path', 'socket_id'
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

    redis_client.store_render_data(render_type,
                                   render_completion_data["user_uuid"],
                                   filename,
                                   render_completion_data["render_node_path"])

    socketio.emit(channel, {
        'fileName': filename,
        'nodePath': render_completion_data["render_node_path"]
    },
                  room=render_completion_data["socket_id"])


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
    if glb_suffix not in ["glb", "gltf"]:
        logger.error("Invalid suffix provided: {0}".format(glb_suffix))
        return None, None, None

    output_dir = os.path.join(current_app.static_folder, 'temp')

    render_id = uuid.uuid4()
    render_name = "{0}.{1}".format(render_id, glb_suffix)
    thumbnail_name = "{0}.{1}".format(render_id, cnst.THUMBNAIL_EXT)

    render_path = os.path.join(output_dir, render_name)
    thumbnail_path = os.path.join(output_dir, thumbnail_name)

    return render_id, render_path, thumbnail_path
