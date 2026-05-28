###########################################################
# Dockerfile that builds a Project Zomboid Gameserver
###########################################################
FROM cm2network/steamcmd:root

LABEL maintainer="daniel.carrasco@electrosoftcloud.com"

ENV STEAMAPPID=380870
ENV STEAMAPP=pz
ENV STEAMAPPDIR="${HOMEDIR}/${STEAMAPP}-dedicated"
# Fix for a new installation problem in the Steamcmd client
ENV HOME="${HOMEDIR}"

# Steam beta branch to install. Defaults to "unstable" (Build 42).
# Override at build time:  --build-arg STEAM_BETA=public           (Build 41)
#                          --build-arg STEAM_BETA=b41multiplayer   (B41 MP test)
ARG STEAM_BETA=unstable
ENV STEAM_BETA=${STEAM_BETA}

# Install required packages (dos2unix, supervisor, curl/ca-certs for Node setup)
RUN apt-get update \
  && apt-get install -y --no-install-recommends --no-install-suggests \
  dos2unix \
  supervisor \
  curl \
  ca-certificates \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Generate locales to allow other languages in the PZ Server
RUN sed -i 's/^# *\(es_ES.UTF-8\)/\1/' /etc/locale.gen \
  # Generate locale
  && locale-gen

# Download the Project Zomboid dedicated server app using the steamcmd app
# Set the entry point file permissions
RUN set -x \
  && mkdir -p "${STEAMAPPDIR}" \
  && chown -R "${USER}:${USER}" "${STEAMAPPDIR}" \
  && bash "${STEAMCMDDIR}/steamcmd.sh" +force_install_dir "${STEAMAPPDIR}" \
  +login anonymous \
  +app_update "${STEAMAPPID}" -beta "${STEAM_BETA}" validate \
  +quit

# Copy the entry point file
COPY --chown=${USER}:${USER} scripts/entry.sh /server/scripts/entry.sh
RUN chmod 550 /server/scripts/entry.sh

# Copy searchfolder file
COPY --chown=${USER}:${USER} scripts/search_folder.sh /server/scripts/search_folder.sh
RUN chmod 550 /server/scripts/search_folder.sh

# supervisord configuration (manages the game server + the web admin UI)
COPY config/supervisord.conf /etc/supervisor/supervisord.conf

# Install and copy the web admin UI
COPY webui/package.json webui/package-lock.json* /server/webui/
RUN cd /server/webui \
  && npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY --chown=${USER}:${USER} webui/ /server/webui/
RUN chown -R "${USER}:${USER}" /server/webui

# Create required folders to keep their permissions on mount
RUN mkdir -p "${HOMEDIR}/Zomboid" /var/log/supervisor

WORKDIR ${HOMEDIR}
# Expose ports: game (UDP/TCP) + web admin UI (TCP)
EXPOSE 16261-16262/udp \
  27015/tcp \
  8080/tcp

ENTRYPOINT ["/server/scripts/entry.sh"]