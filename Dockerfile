# Pinned, not :latest. The image is built on whichever host runs the Docker daemon — a Mac on
# arm64 or ezbox on amd64 — and an unpinned base plus an uncopied lock file let those two resolve
# different Deno and dependency versions from identical source.
FROM denoland/deno:2.9.5

WORKDIR /app

COPY deno.json deno.lock ./
COPY src/ src/

RUN deno install

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "src/main.ts"]
