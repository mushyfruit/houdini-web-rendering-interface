import os
import re
import sys
import json
import time
import logging
import threading

from app.api import constants as cnst


class ProgressFilter:
    """Redirects the ALF_PROGRESS updates to a redis client to update the 
    front end's render progress.

    sys.stdout is overriden inside Houdini and requires sys.__stdout__.

    C shared library output is redirected from stdout fd to our pipe_in, 
    filtered, and then sent to redis for updating.
    """

    _escape_char = "\b"

    def __init__(self, redis_client, socket_id, node_path, stream=None):
        self._orig_stream = stream
        self._redis_client = redis_client
        self._socket_id = socket_id
        self._node_path = node_path
        self._regex = re.compile(r'ALF_PROGRESS (\d+)%')
        if not self._orig_stream:
            self._orig_stream = sys.__stdout__

        self._orig_stream_fd = self._orig_stream.fileno()
        self.pipe_out, self.pipe_in = os.pipe()

        self._stream_fd = None
        self._worker_thread = None
        self.debug_mode = False

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, type, value, traceback):
        self.stop()

    def start(self):
        # Save copy of the original file descriptor.
        self._stream_fd = os.dup(self._orig_stream_fd)

        # Replace original stream with the write pipe.
        os.dup2(self.pipe_in, self._orig_stream_fd)

        # Start thread to read the stream.
        self._worker_thread = threading.Thread(target=self.filter_output)
        self._worker_thread.start()

        # Make sure that the thread is running and os.read() has executed:
        time.sleep(0.01)

    def stop(self):
        self._orig_stream.write(self._escape_char)
        self._orig_stream.flush()
        self._worker_thread.join()
        os.close(self.pipe_in)
        os.close(self.pipe_out)
        os.dup2(self._stream_fd, self._orig_stream_fd)
        os.close(self._stream_fd)

    def read_line(self, pipe):
        char = ""
        line = ""
        while char != self._escape_char and char != "\n":
            char = os.read(pipe, 1).decode(self._orig_stream.encoding)
            line += char
        return line

    def filter_output(self):
        while True:
            line = self.read_line(self.pipe_out)
            if not line or self._escape_char in line:
                break

            match_obj = self._regex.search(line)
            if match_obj is not None:
                if self._redis_client and not self.debug_mode:
                    self.update_redis_client(match_obj)
                else:
                    os.write(self._stream_fd, convert_message(match_obj))
            else:
                os.write(self._stream_fd, line.encode("utf-8"))

    def update_redis_client(self, match_obj):
        try:
            progress = match_obj.group(1)
            if not progress.isdigit():
                raise ValueError("Invalid progress data")

            json_data = {
                "progress": match_obj.group(1),
                "socket_id": self._socket_id,
                "nodePath": self._node_path
            }

            self._redis_client.publish(cnst.PublishChannels.thumb_progress,
                                       json.dumps(json_data))
        except Exception as e:
            logging.error("Error in update_redis_client: {0}".format(e))


def convert_message(match_obj):
    new_string = match_obj.group(1)
    update_string = "Update {0}".format(new_string)
    return update_string.encode("utf-8")
