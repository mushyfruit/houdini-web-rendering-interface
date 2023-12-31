import re
import sys
import math
import redis
import argparse

import hou
from flask import current_app
from app.api.stream import ProgressFilter

THUMBNAIL_CAM = "thumbnail_cam1_webrender"
THUMBNAIL_ROP = "thumbnail_karma1_webrender"
GLB_ROP = "thumbnail_gltf1_webrender"
DEFAULT_RES = 512

# Docker automatically resolves this to Redis' internal IP.
redis_client = redis.Redis(host='redis', port=6379, db=0)


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)

    # Option Arguments
    parser.add_argument('-t',
                        dest="thumbnail",
                        action='store_true',
                        help='Indicate whether to render a thumbnail.')
    parser.add_argument(
        '-f',
        '--frames',
        type=parse_tuple,
        help="Specifies the render's frame range as a tuple (start, end, step)"
    )

    # Render path
    parser.add_argument('file', help="Path for the file to render.", type=str)
    parser.add_argument("rop_node",
                        help="Path for the rop to render.",
                        type=str)
    parser.add_argument("render_path",
                        help="Path for the render output",
                        type=str)

    args = parser.parse_args()
    verify_args(args)
    return args


def parse_tuple(value):
    try:
        values = value.split(',')
        if len(values) != 3:
            raise ValueError
        return values
    except ValueError:
        raise argparse.ArgumentTypeError(
            "A tuple of three integers is required (e.g., 1,100, 1)")


def verify_args(args):
    if not args.thumbnail and not args.frames:
        print("Please provide frame range when rendering .glb.")
        sys.exit(1)


def render(args):
    if args.thumbnail:
        generate_thumbnail(args.rop_node, args.render_path, args.file)
    else:
        render_glb(args.rop_node, args.render_path, args.frames, args.file)


def render_glb(node_path, render_path, frames, hip_path):
    hou.hipFile.load(hip_path)

    render_node = hou.node(node_path)
    if not render_node:
        return False

    if render_node.type().category().name() != 'Sop':
        if not render_node.displayNode():
            return False

    out_node = hou.node("/out/{0}".format(GLB_ROP))
    if not out_node:
        out_node = hou.node("/out").createNode("gltf")
        out_node.setName(GLB_ROP)

    # Setup the GLTF ROP Node.
    out_node.parm("trange").set("normal")
    out_node.parm("usesoppath").set(True)
    out_node.parm("soppath").set(node_path)
    out_node.parm('file').set(render_path)

    print("Rendering to: {0}".format(render_path))

    # Directly set, rather than passing `frame_range` in render call
    # Useful to query "f2" to determine progress in callback.
    for i in range(3):
        index_str = str(i + 1)
        f_parm = out_node.parm("f{0}".format(index_str))
        f_parm.deleteAllKeyframes()
        f_parm.set(frames[i])

    out_node.addRenderEventCallback(update_progress)
    out_node.render()
    out_node.removeRenderEventCallback(update_progress)
    on_completion_notification(hip_path, node_path, "glb")


def update_progress(rop_node, render_event_type, time):
    # Update the correct loading bar with "data-node-name" attribute via `nodeName`.
    if render_event_type == hou.ropRenderEventType.PostFrame:
        render_node = rop_node.parm("soppath").evalAsNode()
        endFrame = rop_node.parm("f2").evalAsFloat()
        progress = (hou.intFrame() / endFrame) * 100.0
        redis_client.publish(
            'render_updates', '{0} {1}'.format(render_node.name(),
                                               str(progress)))


def render_thumbnail_with_karma(node_path, camera_path, thumbnail_path):
    out_node = hou.node("/out/{0}".format(THUMBNAIL_ROP))
    if not out_node:
        out_node = hou.node("/out").createNode("karma")
        out_node.setName(THUMBNAIL_ROP)

        out_node.parm("resolutionx").set(DEFAULT_RES)
        out_node.parm("resolutiony").set(DEFAULT_RES)

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

    stream_filter = ProgressFilter(redis_client=redis_client)
    with stream_filter:
        out_node.render(verbose=True, output_progress=True)


def generate_thumbnail(node_path, thumbnail_path, hip_path):
    """Either need to set up dockerfile with OpenGL or use Karma CPU engine.

    Probably want to avoid any GPU requirements right now.

    Karma/Mantra seems a bit too slow...
    """
    hou.hipFile.load(hip_path)
    # Create and position a camera
    out_camera = hou.node("/obj/{0}".format(THUMBNAIL_CAM))
    if not out_camera:
        out_camera = hou.node("/obj").createNode("cam")
        out_camera.setName(THUMBNAIL_CAM)
        out_camera.parm("resx").set(DEFAULT_RES)
        out_camera.parm("resy").set(DEFAULT_RES)

        # Adjust focal length so everything doesn't look dorky.
        out_camera.parm("focal").set(200)

    render_obj = hou.node(node_path)

    # Need a SOP node to calculate the OBJ's bbox.
    if render_obj.type().category().name() == 'Sop':
        sop_geo = render_obj.geometry().freeze()
        render_obj = render_obj.parent()
        render_obj.setDisplayFlag(True)
    else:
        sop_geo = render_obj.displayNode().geometry().freeze()

    # UI is not available, can't use hou.GeometryViewport.frameSelected() :(
    frame_selected_bbox(render_obj, out_camera, sop_geo)
    render_thumbnail_with_karma(node_path, out_camera.path(), thumbnail_path)
    on_completion_notification(hip_path, node_path, "thumb")


def frame_selected_bbox(render_obj, camera, sop_geo):
    # Calculates w/r/t SOP context.
    bbox = sop_geo.boundingBox()
    obj_origin = render_obj.origin()
    bbox_center = bbox.center() + obj_origin

    adjust_height = hou.Vector3(bbox_center.x(), bbox_center.y(),
                                bbox_center.z() + 115.0)
    transform = hou.hmath.buildTranslate(adjust_height)
    camera.setWorldTransform(transform)

    # Hacky AF
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


def on_completion_notification(node_path, hip_path, render_type):
    redis_client.publish('render_completion_channel',
                         ' '.join([hip_path, node_path, render_type]))


# Allow for execution via subprocess via CLI.
if __name__ == "__main__":
    args = parse_args()
    render(args)
