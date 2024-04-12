import math
import json
import logging

import hou

from app.api import progress_filter
from app import redis_client, constants as cnst


def render_glb(render_data, hip_path):
    try:
        hou.hipFile.load(hip_path)
    except hou.LoadWarning as e:
        logging.error(e.instanceMessage())
        return None

    node_path = render_data["node_path"]
    glb_path = render_data["glb_path"]

    logging.info("Received render request for GLB: {0}".format(
        str(render_data)))

    render_node = hou.node(node_path)
    if not render_node:
        return False

    if render_node.type().category().name() != 'Sop':
        if not render_node.displayNode():
            return False

    out_node = hou.node("/out/{0}".format(cnst.GLB_ROP))
    if out_node is None:
        out_node = hou.node("/out").createNode("gltf")
        out_node.setName(cnst.GLB_ROP)

    # Set up the GLTF ROP Node.
    out_node.parm("trange").set("normal")
    out_node.parm("usesoppath").set(True)
    out_node.parm("soppath").set(node_path)

    logging.info("Rendering to: {0}".format(glb_path))
    out_node.parm('file').set(glb_path)

    # Directly set, rather than passing `frame_range` in render call
    # Useful to query "f2" to determine progress in callback.
    frames = (render_data["start"], render_data["end"], render_data["step"])
    for i in range(3):
        index_str = str(i + 1)
        f_parm = out_node.parm("f{0}".format(index_str))
        f_parm.deleteAllKeyframes()
        f_parm.set(frames[i])

    # Store the redis socket ID for retrieval in callback.
    out_node.setCachedUserData("socket_id", render_data["socket_id"])
    out_node.addRenderEventCallback(update_progress)

    try:
        out_node.render()
    except hou.OperationFailed as exc:
        logging.error(exc)
    else:
        on_completion_notification(node_path,
                                   glb_path,
                                   cnst.BackgroundRenderType.glb_file,
                                   render_data["user_uuid"],
                                   socket_id=render_data["socket_id"])
    finally:
        out_node.removeRenderEventCallback(update_progress)
        out_node.destroyCachedUserData("socket_id", must_exist=False)


def update_progress(rop_node, render_event_type, time):
    # Update the correct loading bar with "data-node-name" attribute via `nodeName`.
    if render_event_type == hou.ropRenderEventType.PostFrame:
        render_node = rop_node.parm("soppath").evalAsNode()
        end_frame = rop_node.parm("f2").evalAsFloat()
        progress = (hou.intFrame() / end_frame) * 100.0

        socket_id = rop_node.cachedUserData("socket_id")
        if socket_id is not None:
            render_update_data = {
                "render_node_path": render_node.path(),
                "socket_id": socket_id,
                "progress": progress
            }
            render_update_json = json.dumps(render_update_data)
            redis_instance = redis_client.get_client_instance()
            redis_instance.publish(cnst.PublishChannels.glb_progress,
                                   render_update_json)


def render_thumbnail_with_karma(node_path, camera_path, thumbnail_path,
                                socket_id):
    out_node = hou.node("/out/{0}".format(cnst.THUMBNAIL_ROP))
    if not out_node:
        out_node = hou.node("/out").createNode("karma")
        out_node.setName(cnst.THUMBNAIL_ROP)

        out_node.parm("resolutionx").set(cnst.DEFAULT_RES)
        out_node.parm("resolutiony").set(cnst.DEFAULT_RES)

        out_node.parm("camera").set(camera_path)
        out_node.parm("samplesperpixel").set(6)
        out_node.parm("enablemblur").set(False)

        # Simple lighting setup.
        env_light = hou.node("/obj").createNode("envlight")
        env_light.parm("env_map").set(
            "$HFS/houdini/pic/hdri/HDRIHaven_lenong_1_2k.rat")

    # Only render the specified node.
    out_node.parm("candobjects").set(node_path)
    out_node.parm("objects").set(node_path)
    out_node.parm("picture").set(thumbnail_path)

    # output_progress on Karma Node doesn't output ALF_PROGRESS
    # Have to ensure -a/A flag is passed to husk command:
    out_node.parm("verbosity").set("a")

    redis_instance = redis_client.get_client_instance()
    stream_filter = progress_filter.ProgressFilter(redis_instance, socket_id,
                                                   out_node.path())
    with stream_filter:
        out_node.render(verbose=True, output_progress=True)


def generate_thumbnail(render_data, hip_path):
    """OpenGL isn't available with current Docker setup (no GPU).

    Instead, render via Karma CPU in separate celery Task.
    """
    hou.hipFile.load(hip_path)
    # Create and position a camera
    out_camera = hou.node("/obj/{0}".format(cnst.THUMBNAIL_CAM))
    if not out_camera:
        out_camera = hou.node("/obj").createNode("cam")
        out_camera.setName(cnst.THUMBNAIL_CAM)
        out_camera.parm("resx").set(cnst.DEFAULT_RES)
        out_camera.parm("resy").set(cnst.DEFAULT_RES)

        # Adjust focal length so everything doesn't look dorky.
        out_camera.parm("focal").set(200)

    render_obj = hou.node(render_data["node_path"])

    with RenderContextManager(render_obj):
        # Need a SOP node to calculate the OBJ's bbox.
        if render_obj.type().category().name() == 'Sop':
            sop_geo = render_obj.geometry().freeze()
            render_obj = render_obj.parent()
        else:
            sop_geo = render_obj.displayNode().geometry().freeze()

        # UI is not available, can't use hou.GeometryViewport.frameSelected() :(
        frame_selected_bbox(render_obj, out_camera, sop_geo)

        thumbnail_path = render_data["thumbnail_path"]
        socket_id = render_data["socket_id"]

        render_thumbnail_with_karma(render_obj.path(),
                                    out_camera.path(), thumbnail_path,
                                    socket_id)

        on_completion_notification(render_data["node_path"],
                                   thumbnail_path,
                                   cnst.BackgroundRenderType.thumbnail,
                                   render_data["user_uuid"],
                                   socket_id=socket_id)


def frame_selected_bbox(render_obj, camera, sop_geo):
    # Calculates w/r/t SOP context.
    bbox = sop_geo.boundingBox()
    obj_origin = render_obj.origin()
    bbox_center = bbox.center() + obj_origin

    adjust_height = hou.Vector3(bbox_center.x(), bbox_center.y(),
                                bbox_center.z() + 115.0)
    transform = hou.hmath.buildTranslate(adjust_height)
    camera.setWorldTransform(transform)

    look_at_cube = hou.node("/obj").createNode("geo")
    look_at_cube.setWorldTransform(hou.hmath.buildTranslate(bbox_center))
    look_at_mtx = camera.buildLookatRotation(look_at_cube)

    rotation_mtx = look_at_mtx.extractRotationMatrix3()
    rotation_tuples = rotation_mtx.asTupleOfTuples()

    # Direction vector is already normalized by `buildLookAtRotation`
    # Get the negative z-axis from the look-at-mtx.
    direction_vector = -hou.Vector3(
        rotation_tuples[2][0], rotation_tuples[2][1], rotation_tuples[2][2])
    camera.setWorldTransform(look_at_mtx)

    apx = camera.parm("aperture").evalAsFloat()
    focal = camera.parm("focal").evalAsFloat()
    resx = camera.parm("resx").evalAsInt()
    resy = camera.parm("resy").evalAsInt()
    asp = camera.parm("aspect").evalAsFloat()

    fovx = 2 * math.atan((apx / 2) / focal)
    apy = (resy * apx) / (resx * asp)
    fovy = 2 * math.atan((apy / 2) / focal)

    bbox_size = bbox.sizevec()
    distance_width = (bbox_size[0] / 2.0) / math.tan(fovx / 2.0)
    distance_height = (bbox_size[1] / 2.0) / math.tan(fovy / 2.0)
    required_distance = max(distance_width, distance_height) + .5

    new_camera_position = bbox_center - (direction_vector * required_distance)

    result = hou.hmath.identityTransform()
    result *= hou.hmath.buildRotate(look_at_mtx.extractRotates())
    result *= hou.hmath.buildTranslate(new_camera_position)

    camera.setWorldTransform(result)


def on_completion_notification(node_path,
                               render_path,
                               render_type,
                               user_uuid,
                               socket_id=None):
    if socket_id is None:
        completed_render_node = hou.node(node_path)
        if completed_render_node is None:
            logging.error("Unable to trigger notification "
                          "on node: {0}".format(" ".join(
                [node_path, render_type])))
            return None
        socket_id = completed_render_node.cachedUserData("socket_id")

    render_completion_data = {
        "user_uuid": user_uuid,
        "render_file_path": render_path,
        "render_node_path": node_path,
        "render_type": render_type,
        "socket_id": socket_id
    }

    render_update_json = json.dumps(render_completion_data)
    logging.info("Render Completion Published: {0}".format(render_update_json))

    redis_instance = redis_client.get_client_instance()
    redis_instance.publish(cnst.PublishChannels.render_completion,
                           render_update_json)


class RenderContextManager:
    def __init__(self, render_obj, parent=None):
        self.render_obj = render_obj
        self.parent = parent

        self.initial_display_flag = None
        self.initial_render_flag = None

        self.display_node = None
        self.render_node = None

        object_category = self.render_obj.type().category()
        self.sop_context = object_category.name() == 'Sop'

    def __enter__(self):
        if self.sop_context:
            self.display_node = self.render_obj.parent().displayNode()
            self.render_node = self.render_obj.parent().renderNode()
            self.initial_render_flag = self.render_obj.isRenderFlagSet()
            self.render_obj.setRenderFlag(True)

        self.initial_display_flag = self.render_obj.isDisplayFlagSet()
        self.render_obj.setDisplayFlag(True)

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.sop_context:
            self.display_node.setDisplayFlag(True)
            self.render_node.setRenderFlag(True)
            self.render_obj.setRenderFlag(self.initial_render_flag)
        self.render_obj.setDisplayFlag(self.initial_display_flag)
