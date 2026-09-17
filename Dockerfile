# Community Solid Server with derived resources.
#
# Runs the Community Solid Server with this package registered as a
# Components.js module, so that derived-resource types are available in server
# configs. Equivalent to running `npm run start:solidbench` in this repo.
#
# It is a drop-in replacement for `solidproject/community-server:7`: the working
# directory, entry point and environment variables are the same, so a Dockerfile
# building on this image only needs to change its `FROM` line.
#
#   docker build -t rubeneschauzier/community-server:dev .

# Build stage
FROM node:18-alpine AS build

# Set current working directory
WORKDIR /community-server

# Install dependencies first, so they stay cached when only sources change
COPY package.json package-lock.json ./
RUN npm ci --unsafe-perm

# Compile TypeScript and generate the Components.js definitions
COPY tsconfig.json .componentsignore ./
COPY src ./src
COPY types ./types
RUN npm run build

# The TypeScript compiler and components generator are not needed at runtime
RUN npm prune --omit=dev


# Runtime stage
FROM node:18-alpine

# Add contact informations for questions about the container
LABEL maintainer="Ruben Eschauzier <ruben.eschauzier@ugent.be>"

# Container config & data dir for volume sharing
# Defaults to filestorage with /data directory (passed through ENV below)
RUN mkdir /config /data

# Set current directory
WORKDIR /community-server

# Copy runtime files from build stage
COPY --from=build /community-server/package.json .
COPY --from=build /community-server/dist ./dist
COPY --from=build /community-server/node_modules ./node_modules

# `config` is exposed through the lsd:importPaths in package.json, so that server
# configs can import the derived-resource config parts by IRI
COPY config ./config
COPY templates ./templates

# Provides the same entry point as the official image; see the file for details
COPY docker/server.js ./bin/server.js

# Informs Docker that the container listens on the specified network port at runtime
EXPOSE 3000

# Set command run by the container
ENTRYPOINT [ "node", "bin/server.js" ]

# Makes Components.js discover this package next to the Community Solid Server.
# Without it, only the server's own components would be available.
ENV CSS_MAIN_MODULE_PATH=/community-server

# By default run in filemode (overriden if passing alternative arguments or env vars)
ENV CSS_CONFIG=@css:config/file.json
ENV CSS_ROOT_FILE_PATH=/data
