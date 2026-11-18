FROM python:3.13-alpine@sha256:9ef1a599f863231c3d91e941389bfdc4a2d6070557243d54df1a4e57015b960e
RUN apk add --no-cache ffmpeg file
COPY inspect_media.py /inspect_media.py
USER 1000:1000
ENTRYPOINT ["python3", "/inspect_media.py"]
