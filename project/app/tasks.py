import os
import subprocess

from celery import shared_task


@shared_task()
def run_task(hip_path, node_path, thumbnail_path):
    cmd = "hython -m app.api.background_render -t '{0}' '{1}' '{2}'".format(
        hip_path, node_path, thumbnail_path)
    thumbnail_process = subprocess.Popen(cmd, env=os.environ, shell=True)
