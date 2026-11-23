# Upstream's image with its Debian packages updated and three build-time
# binaries removed: the depot CLI and the two esbuild binaries.
ARG BASE
FROM ${BASE}
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /calcom/node_modules/@depot \
           /calcom/node_modules/@esbuild/linux-x64 \
           /calcom/node_modules/trigger.dev/node_modules/@esbuild/linux-x64
