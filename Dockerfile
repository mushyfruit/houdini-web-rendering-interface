# FIRST STAGE: Download Houdini
FROM python:3.9-slim AS houdini-downloader

WORKDIR /code
ARG DOWNLOAD_HOUDINI
COPY . ./houdini_install
ENV PYTHONPATH=/code DOCKER_DL=true
RUN mkdir /houdini && \
    if [ "$DOWNLOAD_HOUDINI" = "true" ]; then \
        echo "Downloading houdini..." && \
        pip install --upgrade --no-cache-dir -r houdini_install/requirements_hou.txt && \
        # Set the PYTHONPATH environment variable to include the hinstall directory
        python3 houdini_install/hou_install.py; \
    else \
        echo "Skipping Houdini download and copying from default location." && \
        cp -r ./houdini_install/hou_download/build /houdini/build; \
    fi

# SECOND STAGE: Install and initialize Houdini
FROM python:3.9-slim-buster as houdini-install

RUN apt-get update && \
    apt-get install -y --no-install-recommends iputils-ping \ 
        netcat-traditional ftp telnet procps libjemalloc2 hostname && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=houdini-downloader /houdini /houdiniInstaller
COPY --from=houdini-downloader /code/houdini_install/requirements_app.txt .
RUN python3.9 -m pip install --upgrade --no-cache-dir -r requirements_app.txt

ARG EULA_DATE="2021-10-13"
RUN yes | /houdiniInstaller/build/houdini.install --auto-install --accept-EULA ${EULA_DATE} --make-dir /opt/houdini/build > /output.log 2>&1
RUN rm -r /houdiniInstaller

# THIRD STAGE: Copy houdini-install image and un-cache unnecessary installation files
FROM python:3.9-slim-buster
COPY --from=houdini-install / /

COPY setup_hserver.sh /root/
RUN touch /usr/lib/sesi/licenses && \
    chmod +x /root/setup_hserver.sh

# Set environment variables
ARG SIDEFX_SECRET
ARG SIDEFX_CLIENT
ARG HFS_VER
ENV SIDEFX_CLIENT=$SIDEFX_CLIENT SIDEFX_SECRET=$SIDEFX_SECRET HFS_TARGET=$HFS_VER \
    PATH="${PATH}:/opt/houdini/build/houdini/sbin:/opt/houdini/build/bin" \
    PYTHONPATH="${PYTHONPATH}:/opt/houdini/build/houdini/python3.9libs:/usr/local/lib/python3.9/site-packages:/usr/local/lib64/python3.9/site-packages"

ENV LD_PRELOAD="/opt/houdini/build/dsolib/libjemalloc.so" 
WORKDIR /root/hou_webserver

# Placeholder to keep container alive.
CMD tail -f /dev/null