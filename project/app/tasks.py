from celery import shared_task


@shared_task()
def run_thumbnail_task(hip_path, node_path, thumbnail_path):
    from app.api import background_render
    background_render.generate_thumbnail(node_path, thumbnail_path, 
                                         hip_path=hip_path)


@shared_task()
def run_render_task(hip_path, node_path, glb_path, frames_tuple):
    from app.api import background_render
    background_render.render_glb(
        node_path, glb_path, frames_tuple, hip_path=hip_path)