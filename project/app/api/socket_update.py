import os
import uuid
from collections import namedtuple

from flask import request, current_app, session, jsonify

from app import socketio
from app.api import redis_client, hou_api


class RenderTaskStruct(
        namedtuple(
            "RenderTaskStruct",
            "node_path glb_path thumbnail_name start end step socket_id")):
    """Immutable data struct defining necessary fields to perform the
    render task.

    """
    __slots__ = ()


@socketio.on('connect')
def connect():
    sid = request.sid


@socketio.on('submit_render_task')
def receive_render_task(render_data):
    socket_id = request.sid
    start = render_data.get('start')
    end = render_data.get('end')
    step = render_data.get('step')
    node_path = render_data.get('path')

    if not node_path:
        return {"message": "Invalid submission node.", "success": False}

    filename, glb_path, thumbnail_name = generate_uuid_filepath("glb")
    render_struct = RenderTaskStruct(node_path=node_path,
                                     glb_path=glb_path,
                                     thumbnail_name=thumbnail_name,
                                     start=start,
                                     end=end,
                                     step=step,
                                     socket_id=socket_id)
    result = hou_api.submit_node_for_render(render_struct)

    if not result:
        return {"message": "Render submission failed.", "success": False}

    session.setdefault('rendered_filenames', {})[filename] = glb_path
    # Ensure the nested dict is maintained in session obj.
    session.modified = True

    # SocketIO will handle the serialization to JSON.
    return {
        "message": "Submission succeeded.",
        "filename": filename,
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
    pubsub.subscribe('render_updates', 'thumb_updates',
                     'render_completion_channel')

    for message in pubsub.listen():
        if message['type'] == 'message':
            channel = message['channel'].decode('utf-8')
            if channel == "render_completion_channel":
                print("Received:", message['data'])
            elif channel == "render_updates":
                progress_string = message['data'].decode('utf-8')
                render_node_name, progress = progress_string.split(" ")
                socketio.emit('progress_update', {
                    'nodeName': render_node_name,
                    'progress': progress
                })
            elif channel == "thumb_updates":
                progress_percentage = float(message['data'].decode('utf-8'))
                print(progress_percentage)


def generate_uuid_filepath(suffix):
    output_dir = os.path.join(current_app.static_folder, 'temp')
    filename = "{0}.{1}".format(uuid.uuid4(), suffix)
    thumbnail = "{0}.{1}".format(uuid.uuid4(), "png")
    return filename, os.path.join(output_dir, filename), thumbnail
