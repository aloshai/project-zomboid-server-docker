# Project Zomboid dedicated server container

This Dockerfile downloads the Project Zombie dedicated server using SteamCMD. Will allow you to deploy with ease a server in Kubernetes, Docker...

The ready to use image is available here:

https://hub.docker.com/r/danixu86/project-zomboid-dedicated-server

**WARNING:** Running the image on Windows using WSL2 in Docker Desktop will make the server startup times significantly slower. This is fine unless you are running alot of mods in which case server startup times may vary from 15 - 40 minutes. The best way to solve this problem is to run your container on a Linux based system or in a Linux VM.

## Steam branch (Build 41 vs Build 42)

The image now defaults to **Build 42 (`unstable` Steam beta branch)**. The branch is set via the `STEAM_BETA` build arg:

| Branch              | Build      | Notes                                          |
| ------------------- | ---------- | ---------------------------------------------- |
| `unstable` *(default)* | 42      | Public Build 42 beta — current "latest"        |
| `public`            | 41         | Old stable Build 41                            |

Override at build time:

```bash
STEAM_BETA=public docker compose build
```

Or via `.env`:

```env
STEAM_BETA=unstable
```

When `FORCEUPDATE=1` is set, the entry script will pull the same branch on every container start, so switching `STEAM_BETA` and rebuilding is all that's needed to migrate between B41 and B42.

## Environment variables

This dockerfile converts some env variables to arguments in the server command, allowing to configure it. The image supports the following environment variables:

`ADMINUSERNAME:` Sets the administrator username, otherwise `admin` will be used.

`ADMINPASSWORD:` Sets or changes the admin password. Is mandatory at first startup or will fail. I recommend to remove it once the server is started because the server logs every argument in clear text (if doesn't cares, you can leave it).

`PASSWORD:` Sets or changes server password. Is optional.

`CACHEDIR:` Set the folder where the data will be stored. By default the server stores the data in the Zomboid folder in home directory (/home/steam/Zomboid). Is recommended to store this data into a persistent volume to keep the server state.

`DEBUG:` Enable the debug mode in server

`FORCEUPDATE:` Force a server update on every start. This process can be slow if the image is old.

`FORCESTEAMCLIENTSOUPDATE:` Forcibly update the steamclient.so libraries in the pz-dedicated directory before starting the server. May help with Workshop item downloads. Do not set if everything works fine.

`IP:` Set the interface IP where the server will listen. By default all the interfaces.

`MEMORY:` Amount of memory to use in the server JVM (units can be used, for example 2048m). By default 8096m.

`MODFOLDERS`: Mod folders to use to load the game mods. Allowed options are workshop, steam, and mods. Options must be separated by comma, for example: workshop,steam,mods

`NOSTEAM:` Starts the server in NoSteam mode, allowing to non steam users to connect.

`PORT:` Set the server port. By default 16261

`SERVERNAME:` Set the server name, which allows you to have multiple server versions. Changing the name will create a new server data, so current progress will not be available. Also will not be lost, just reverting the server name change will load it again. **NOTE: Don't use spaces or special characters or admin user will fail**

`SERVERPRESET:` Set the new servers default preset. If not set, the default is apocalypse. Allowed options are Apocalypse, Beginner, Builder, FirstWeek, SixMonthsLater, Survival and Survivor.

`SERVERPRESETREPLACE:` Replace the server preset by the one seted by the SERVERPRESET variable. By default false to avoid to replace custom configurations once the server has started.

`SOFTRESET:` Performs a soft reset in the server. More info in the Soft Reset section.

`STEAMPORT1 & STEAMPORT2:` Sets the two additional ports required for steam to work. I guess that those ports are UDP, but it can be also TCP.

`STEAMVAC:` Enables or disables de SteamVac protection in server

`WORKSHOP_IDS:` Semicolon separated list of Workshop IDs to install to the server. Leaving this empty will clear any existing value!

`MOD_IDS:` Semicolon separated list of Mod IDs to install to the server

`LANG:` This env variable will set the container locales, which will be used by the pz server to set the language. Example (en_EN.UTF-8, es_ES.UTF-8...)

Mods will install on second server start

Maps are added on third server start, after mods are added
## Soft Reset

Soft reset will perform the following tasks:

* Removes items from the ground.
* Removes items from containers and replaces them with new loot. This includes player-made containers.
* Removes corpses and zombified players.
* Resets zombies.
* Removes blood splatter.
* Resets building alarms.
* Resets the game clock. I’m not positive if this resets to day 1, but the original blog post implies that it does. So this would bring water and electricity back. Assuming your server settings have them * available at day 1.
* Player-made buildings won’t be deleted.
* Player inventories won’t reset.

Removing the following files in the Server data folder (ToDo: I have to search the equivalent files in modern version):

* all zombie_X_Y.bin files
* map_t.bin
* map_meta.bin
* reanimated.bin

Currently is not working correctly and will cause the server to crash when it is active. Also the above points are not performed so nothign will change in the server.

## Required ports

The required ports are docummented in the [Official wiki](https://pzwiki.net/wiki/Dedicated_Server#Forwarding_Required_Ports)

For now the ports are the following, but it can change.

### Steam clients ports

This ports are used by the Steam clients to connect with the server, so it must be opened in firewall and configured in NAT.

* 8766 UDP
* 8767 UDP
* 16261 UDP (configurable)

### Non Steam clients ports

This ports are used by the No Steam clients to connect with the server, so it must be opened in firewall and configured in NAT.

* 8766 UDP
* 8767 UDP
* 16261 UDP (configurable)
* 16262 - 16272 TCP (range depends of the above port and the clients slots)

### Notes

* The 16261 port can be changed using the PORT environment variable. This will affect at the TCP ports range, changing it to the next port. For example, if PORT is set to 12234, the TCP range will be 12234 - 12244.
* The TCP ports range is used by the clients, so every client slot will need a port. If your server plans to host 50 clients, then you will need to open 50 ports in firewall/nat... (16262 - 16312).
* The Wiki says that Non Steam ports is supposed to be for non steam clients, but I am using the steam client and those ports are used too.

## How to use the image

To setup the server you can use the docker-compose program:

* Copy the .env.template to .env and edit it with the settings you want. The only mandatory variable is ADMINPASSWORD and just the first time the server is executed (once is started at least once, it can be removed). The other variables are optional.
* Run the `docker-compose up -d` command to start the server.

## Web admin UI

The image bundles a small web admin UI (Node/Express) so you can manage the
server from the browser without editing files by hand. It runs in the same
container alongside the game server, managed by `supervisord`, and edits the
config files in place inside the `zomboid-data` volume.

Features:

- **Dashboard** — server status, Start / Stop / Restart, and a live log stream.
- **Server** — edit `servertest.ini` (auto-generated form from the live file).
- **Sandbox** — edit `SandboxVars.lua` (typed form, auto-generated by parsing the
  file, so it adapts to Build 41/42 differences; a raw-Lua editor is also available).
- **Mods** — manage the `Mods=` and `WorkshopItems=` lists. New Workshop items are
  downloaded on the next restart.

After saving any settings the UI shows a "restart required" banner; click
**Restart** to apply (the game server reads its config on startup).

### Enabling it

Set these env vars (see `.env.template`):

| Variable             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `UI_ADMIN_USER`      | Admin username (default `admin`).                              |
| `UI_ADMIN_PASSWORD`  | Admin password. **Login is disabled until this is set.**       |
| `UI_SESSION_SECRET`  | Long random string used to sign session cookies.               |
| `UI_PORT`            | Port inside the container (default `8080`).                    |
| `UI_DOMAIN`          | Domain Traefik routes the UI on (used by the compose label).   |

The UI is HTTP, so — unlike the raw UDP/TCP game ports — it **can** be routed by
domain. `docker-compose.yml` ships a Traefik HTTP router
(`Host(${UI_DOMAIN})` + TLS via the `letsencrypt` resolver) so you get
`https://pz-admin.example.com` with a real certificate, no domain binding from
the Dokploy UI required.

> **Source of truth:** once the server has run once, the UI owns the `Mods=` /
> `WorkshopItems=` values. The `MOD_IDS` / `WORKSHOP_IDS` env vars are only used
> to bootstrap them on first run; after that, manage mods from the UI.

### Local development of the UI

```bash
cd webui
npm install
npm test                      # parser round-trip tests
ZOMBOID_DIR=/path/to/Zomboid UI_ADMIN_PASSWORD=secret npm start
```

## Deploying on Dokploy

The shipped `docker-compose.yml` is wired for Dokploy:

- **Game ports** (`16261/udp`, `16262/udp`, `27015/tcp`) are published **directly on
  the host** via `ports:`. Game traffic is raw UDP/TCP — a reverse proxy can't route
  it by domain — so direct publishing is the simplest, lowest-latency, and least
  risky option (no changes to the shared Traefik).
- **Web admin UI** joins the `dokploy-network` and is routed by Traefik over HTTPS
  using the `Host(${UI_DOMAIN})` label, so you get a real certificate at
  `https://<your-domain>` with no domain binding from the Dokploy UI.

### 1. Open the game ports on the host firewall

```bash
ufw allow 16261/udp
ufw allow 16262/udp
ufw allow 27015/tcp
```

(or the equivalent in your cloud provider's security group).

### 2. Point a DNS record at the server for the UI

Create an `A` record for `UI_DOMAIN` (e.g. `pz-admin.example.com`) pointing at the
Dokploy host IP, so Traefik can issue a Let's Encrypt certificate.

### 3. Deploy

Create a **Docker Compose** service in Dokploy pointing at this repo (branch `main`,
compose path `docker-compose.yml`), set the env vars (at minimum `ADMINPASSWORD`,
`UI_ADMIN_PASSWORD`, `UI_SESSION_SECRET`, `UI_DOMAIN`), and deploy. Players connect to
`host-ip:16261` (or a DNS name pointing at it); you manage the server at
`https://<UI_DOMAIN>`.

## Scripts folder

In the scripts folders there are three scripts:

* entry.sh: The script used in the image to start the server
* search_folder.sh: Script to search through mod folders for any maps 
* update_forum.sh: Check the posts in the forum for updates and create a new image if a new version exists. This script was made because looks like the official page doesn't update the version as soon it is out.
* uodate_web.sh: Check the version in the official page and create a new image if a new version exists
