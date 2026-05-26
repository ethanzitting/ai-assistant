FROM denoland/deno:latest

WORKDIR /app

COPY deno.json .
COPY src/ src/

RUN deno install

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "src/main.ts"]
