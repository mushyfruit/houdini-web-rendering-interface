import os
import math
import json
import uuid
import logging
from pathlib import Path

import hou

from app.api import progress_filter
from app import redis_client, constants as cnst


def generate_render_path(original_render_path, out_node, file_uuid, force_png=False):
    render_id = str(uuid.uuid4())
    path = Path(original_render_path)
    original_file_name = path.stem + path.suffix

    target_path = os.path.join(cnst.USER_RENDER_DIR, render_id, original_file_name)

    if "$HIPNAME" in target_path:
        # Manually replace as our hip gets saved to an UUID.
        original_hip_name = redis_client.get_hip_name_from_uuid(file_uuid)
        if original_hip_name:
            target_path = target_path.replace("$HIPNAME", original_hip_name.split(".")[0])

    # Replacement can be strange at times.
    if "$OS" in target_path:
        target_path = target_path.replace("$OS", out_node.name())

    if force_png:
        target_path = os.path.join(cnst.USER_THUMB_DIR, render_id + ".png")

    return target_path, render_id


def render_rop(render_data, hip_path, force_png=False):
    hou.hipFile.load(hip_path, suppress_save_prompt=True, ignore_load_warnings=True)
    out_node_path = render_data["node_path"]
    out_node = hou.node(out_node_path)

    out_node.setCachedUserData("socket_id", render_data["socket_id"])

    out_path = None
    for parm_name in cnst.FILE_OUTPUT_PARMS:
        parm = out_node.parm(parm_name)
        if parm is not None:
            out_path = parm.unexpandedString()
            logging.info("Rendering to: {0}".format(out_path))

    if not out_path:
        return

    updated_render_path, render_id = generate_render_path(out_path, out_node,
                                                          render_data["file_uuid"],
                                                          force_png=force_png)
    frame_range_tuple = (render_data["start"], render_data["end"])

    if force_png:
        render_data["thumbnail_path"] = hou.text.expandString(updated_render_path)
        out_node.addRenderEventCallback(update_progress)
        out_node.setCachedUserData("rop_data", render_data)
        frame_range_tuple = (render_data["start"], render_data["start"])

    redis_instance = redis_client.get_client_instance()
    stream_filter = progress_filter.ProgressFilter(
        redis_instance, render_data["socket_id"], out_node_path,
        channel=cnst.PublishChannels.glb_progress
    )
    try:
        with stream_filter:
            out_node.render(
                frame_range_tuple,
                output_file=updated_render_path,
                verbose=True,
                output_progress=True)
    except hou.OperationFailed as exc:
        logging.error(exc)
    else:
        if not force_png:
            on_completion_notification(out_node_path,
                                       hou.text.expandString(updated_render_path),
                                       cnst.BackgroundRenderType.rop_render,
                                       render_id,
                                       (render_data["start"], render_data["end"]),
                                       socket_id=render_data["socket_id"],
                                       rop_uuid_prefix=render_id)
    finally:
        if force_png:
            out_node.removeRenderEventCallback(update_progress)
        out_node.destroyCachedUserData("socket_id", must_exist=False)
        out_node.destroyCachedUserData("rop_render", must_exist=False)
        out_node.destroyCachedUserData("rop_data", must_exist=False)


def render_glb(render_data, hip_path):
    hou.hipFile.load(hip_path, suppress_save_prompt=True, ignore_load_warnings=True)

    node_path = render_data["node_path"]
    glb_path = render_data["glb_path"]

    logging.info("Received render request for GLB: {0}".format(
        str(render_data)))

    render_node = hou.node(node_path)
    if not render_node:
        logging.error("Invalid node path passed. Unable to locate node.")
        return False

    is_manager = render_node.type().isManager()
    render_path = node_path

    if render_node.type().category() != hou.ropNodeTypeCategory():
        if render_node.type().category() != hou.sopNodeTypeCategory() and not is_manager:
            if not render_node.renderNode():
                logging.error("No render node specified for {0}".format(node_path))
                return False

        out_node = hou.node("/out/{0}".format(cnst.GLB_ROP))
        if out_node is None:
            out_node = hou.node("/out").createNode("gltf")
            out_node.setName(cnst.GLB_ROP)
    else:
        out_node = render_node

    # Set up the GLTF ROP Node.
    category = render_node.type().category()
    prepare_gltf_rop(out_node, category, is_manager, render_data, render_path, glb_path)

    # Bake any CHOP data on object level transforms
    if render_node.type().isManager():
        for node in render_node.children():
            bake_object_transforms(node, render_data)
    else:
        bake_object_transforms(render_node, render_data)

    # Object-level transforms when overridden by CHOP track, will not be processed.
    # Bake them here to ensure the transform information is passed to GLTF ROP.
    bake_object_transforms(render_node, render_data)

    # Store the redis socket ID for retrieval in callback.
    out_node.setCachedUserData("socket_id", render_data["socket_id"])
    out_node.setCachedUserData("target_node", render_path)

    out_node.addRenderEventCallback(update_progress)

    try:
        out_node.render()
    except hou.OperationFailed as exc:
        logging.error(exc)
    else:
        on_completion_notification(node_path,
                                   glb_path,
                                   cnst.BackgroundRenderType.glb_file,
                                   render_data["file_uuid"],
                                   (render_data["start"], render_data["end"]),
                                   socket_id=render_data["socket_id"])
    finally:
        out_node.removeRenderEventCallback(update_progress)
        out_node.destroyCachedUserData("socket_id", must_exist=False)


def bake_object_transforms(node, render_data):
    rotation_parm = node.parmTuple("r")
    translate_parm = node.parmTuple("t")
    scale_parm = node.parmTuple("s")

    # Object-level transforms when overridden by CHOP track, will not be processed.
    # Bake them here to ensure the transform information is passed to GLTF ROP.
    for parmTuple in (rotation_parm, translate_parm, scale_parm):
        if parmTuple is None:
            continue

        for parm in parmTuple:
            if parm.isOverrideTrackActive():
                parm.keyframesRefit(
                    False,
                    0, 1, 1,
                    True,  # Resample operation prior to refitting.
                    1.0,  # Resample rate (1.0 = keyframe per frame)
                    0,  # Resample tolerance in frames.
                    True,  # Use a supplied range for baking.
                    render_data["start"], render_data["end"],
                    hou.parmBakeChop.KeepExportFlag  # Keep CHOP export flag, but baked animation is present.
                )


def prepare_gltf_rop(out_node, category, is_manager, render_data, render_path, glb_path):
    if is_manager or category == hou.objNodeTypeCategory():
        out_node.parm("usesoppath").set(False)
        out_node.parm("soppath").set('')
        out_node.parm("objpath").set(render_path)
    elif category != hou.ropNodeTypeCategory():
        # Set up the GLTF ROP Node.
        out_node.parm("usesoppath").set(True)
        out_node.parm("soppath").set(render_path)
        out_node.parm("objpath").set('')

    logging.info("Rendering to: {0}".format(glb_path))
    out_node.parm("trange").set("normal")
    out_node.parm('file').set(glb_path)

    # Default animation name appears under "Animation Folder"
    # out_node.parm('animationname').set("WebRenderDefault")

    # Directly set, rather than passing `frame_range` in render call
    # Useful to query "f2" to determine progress in callback.
    _set_frame_data(out_node, render_data)

    export_settings = render_data["export_settings"]
    for parmName, value in export_settings.items():
        try:
            out_node.parm(parmName.lower()).set(value)
        except Exception as e:
            logging.error("Failed to set export setting: "
                          "{0}\n{1}".format(parmName.lower(), e))


def update_progress(rop_node, render_event_type, time):
    # Update the correct loading bar with "data-node-name" attribute via `nodeName`.
    if render_event_type == hou.ropRenderEventType.PostFrame:
        if rop_node.cachedUserData("rop_data"):
            rop_data = rop_node.cachedUserData("rop_data")
            if hou.intFrame() == rop_data["start"]:
                on_completion_notification(
                    rop_data["node_path"],
                    hou.expandStringAtFrame(rop_data["thumbnail_path"], hou.intFrame()),
                    cnst.BackgroundRenderType.thumbnail,
                    rop_data["file_uuid"],
                    None,
                    socket_id=rop_data["socket_id"])
            return

        else:
            if rop_node.cachedUserData("target_node"):
                render_node_path = rop_node.cachedUserData("target_node")
            else:
                render_node_path = rop_node.path()

        end_frame = rop_node.parm("f2").evalAsFloat()
        progress = (hou.intFrame() / end_frame) * 100.0

        socket_id = rop_node.cachedUserData("socket_id")
        if socket_id is not None:
            render_update_data = {
                "render_node_path": render_node_path,
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
    if hou.node(node_path).type().isManager():
        out_node.parm("candobjects").set("{0}/*".format(node_path))
    else:
        out_node.parm("candobjects").set(node_path)
        out_node.parm("objects").set(node_path)

    out_node.parm("picture").set(thumbnail_path)

    # Workaround for <= 19.5 hou versions:
    #     output_progress on Karma Node doesn't output ALF_PROGRESS
    #     Have to ensure -a/A flag is passed to husk command:

    # out_node.parm("verbosity").set("a")

    # For >= 20.0 hou version
    out_node.parm("alfprogress").set(True)

    redis_instance = redis_client.get_client_instance()
    stream_filter = progress_filter.ProgressFilter(redis_instance, socket_id,
                                                   out_node.path())
    with stream_filter:
        out_node.render(verbose=True, output_progress=True)


def generate_thumbnail(render_data, hip_path, generate_for_rop=False):
    """OpenGL isn't available with current Docker setup (no GPU).

    Instead, render via Karma CPU in separate celery Task.
    """
    # Suppress hou.LoadWarning exceptions.
    hou.hipFile.load(
        hip_path, suppress_save_prompt=True, ignore_load_warnings=True)

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
    if render_obj.type().category() == hou.ropNodeTypeCategory():
        obj_parm = render_obj.parm("objpath")
        sop_parm = render_obj.parm("soppath")
        if obj_parm is None:
            if sop_parm:
                render_obj = sop_parm.evalAsNode()
        elif obj_parm.isDisabled() and sop_parm is not None:
            render_obj = sop_parm.evalAsNode()
        elif sop_parm is not None:
            render_obj = obj_parm.evalAsNode()

    if render_obj is None and generate_for_rop:
        # Fallback to just generating a thumbnail for the obj context.
        render_obj = hou.node("/obj")
    elif render_obj is None:
        logging.error("Error encountered when attempting to render {0}. "
                      "Invalid render object specified.".format(render_data["node_path"]))

    with RenderContextManager(render_obj):
        # Need a SOP node to calculate the OBJ's bbox.
        if render_obj.type().isManager():
            default_bbox = hou.BoundingBox()
            for node in render_obj.children():
                # Just take into account geometry object nodes.
                # Not great, but covers most scenarios.
                if node.type().name() == "geo":
                    try:
                        bbox = node.renderNode().geometry().boundingBox()
                        bbox *= node.worldTransform()
                        default_bbox.enlargeToContain(bbox)
                    except AttributeError:
                        continue
            frame_selected_bbox(render_obj, out_camera, bbox=default_bbox)
        else:
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
                                   render_data["file_uuid"],
                                   None,
                                   socket_id=socket_id)


def frame_selected_bbox(render_obj, camera, sop_geo=None, bbox=None):
    # Calculates w/r/t SOP context.
    if bbox is None:
        bbox = sop_geo.boundingBox()

    try:
        obj_origin = render_obj.origin()
    except AttributeError:
        obj_origin = hou.Vector3(0, 0, 0)

    # Scale up our bbox for a bit of padding.
    scale_factor = 1.50
    center = bbox.center()
    new_size_x = (bbox.sizevec()[0] * scale_factor) / 2
    new_size_y = (bbox.sizevec()[1] * scale_factor) / 2
    new_size_z = (bbox.sizevec()[2] * scale_factor) / 2

    # Set the new min and max vectors based on the scaled size
    new_min = hou.Vector3(center[0] - new_size_x, center[1] - new_size_y, center[2] - new_size_z)
    new_max = hou.Vector3(center[0] + new_size_x, center[1] + new_size_y, center[2] + new_size_z)

    # Create a new bounding box with the enlarged size
    enlarged_bbox = hou.BoundingBox(new_min[0], new_min[1], new_min[2], new_max[0], new_max[1], new_max[2])
    bbox = enlarged_bbox

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
                               file_uuid,
                               frames,
                               socket_id=None,
                               rop_uuid_prefix=None):
    if socket_id is None:
        completed_render_node = hou.node(node_path)
        if completed_render_node is None:
            logging.error("Unable to trigger notification "
                          "on node: {0}".format(" ".join(
                [node_path, render_type])))
            return None
        socket_id = completed_render_node.cachedUserData("socket_id")

    render_completion_data = {
        "file_uuid": file_uuid,
        "render_file_path": render_path,
        "render_node_path": node_path,
        "render_type": render_type,
        "socket_id": socket_id,
        "frame_info": frames
    }

    if rop_uuid_prefix:
        render_completion_data["rop_uuid"] = rop_uuid_prefix

    render_update_json = json.dumps(render_completion_data)
    logging.info("Render Completion Published: {0}".format(render_update_json))

    redis_instance = redis_client.get_client_instance()
    redis_instance.publish(cnst.PublishChannels.render_completion,
                           render_update_json)


def _set_frame_data(out_node, render_data):
    frames = (render_data["start"], render_data["end"], render_data["step"])
    for i in range(3):
        index_str = str(i + 1)
        f_parm = out_node.parm("f{0}".format(index_str))
        f_parm.deleteAllKeyframes()
        f_parm.set(frames[i])


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

        self.is_manager = self.render_obj.type().isManager()

    def __enter__(self):
        if self.is_manager:
            return

        if self.sop_context:
            self.display_node = self.render_obj.parent().displayNode()
            self.render_node = self.render_obj.parent().renderNode()
            self.initial_render_flag = self.render_obj.isRenderFlagSet()
            self.render_obj.setRenderFlag(True)

        self.initial_display_flag = self.render_obj.isDisplayFlagSet()
        self.render_obj.setDisplayFlag(True)

    def __exit__(self, exc_type, exc_val, exc_tb):
        # If we're rendering a manager level context, no need to track
        # and restore flag state.
        if self.is_manager:
            return

        if self.sop_context:
            self.display_node.setDisplayFlag(True)
            self.render_node.setRenderFlag(True)
            self.render_obj.setRenderFlag(self.initial_render_flag)
        self.render_obj.setDisplayFlag(self.initial_display_flag)
