# Asterisk Console

Panel web (Node.js) para monitorear un servidor Asterisk: llamadas en vivo, errores, histórico (CDR/CEL), grabaciones y parámetros del servidor.

- **En vivo**: llamadas y canales activos vía AMI, errores (hangups anómalos, marcaciones fallidas, registros rechazados, intentos de acceso) vía WebSocket.
- **Histórico**: lee el CDR/CEL que Asterisk ya guarda (MySQL/MariaDB, PostgreSQL o SQLite). Filtros por fecha, número, origen, destino, uniqueid/linkedid, estado, duración, canal; detalle con CEL y exportación CSV.
- **Grabaciones**: directorios configurables desde la GUI; `mp3`, `wav` y `WAV` (sin distinguir mayúsculas). Filtros, reproductor con rango/velocidad, descarga y enlace con la llamada del CDR.
- **Servidor**: extensiones/troncales (PJSIP y chan_sip), colas, archivos de configuración (ocultando secretos) y consola de solo consultas.
- **Seguridad**: login con usuario/contraseña (bcrypt), roles administrador / solo lectura, cookie firmada `HttpOnly`+`SameSite=Strict`, bloqueo tras 5 intentos fallidos, secretos guardados cifrados (AES-256-GCM).

Todo se configura desde la GUI (Configuración). El `.env` solo tiene lo básico.

## Requisitos
Node.js ≥ 20.11. En Node ≥ 22.5 usa el SQLite integrado; en Node 20 usa `better-sqlite3` (se instala solo con `npm install`; si falla la compilación necesita `build-essential`/`python3`).

## Puesta en marcha
```bash
npm install
cp .env.example .env      # opcional
npm start
```
Abra `http://servidor:3000`. La primera vez se crea el usuario `admin` y su contraseña se imprime en consola (o la de `ADMIN_PASSWORD`). Luego vaya a **Configuración** para indicar AMI, base de datos y directorios de grabaciones.

### `.env`
| Variable | Descripción |
|---|---|
| `PORT`, `HOST` | Dirección de escucha de la GUI |
| `DATA_DIR` | Carpeta de la base SQLite de la GUI (`./data`) |
| `APP_SECRET` | Clave de firma/cifrado (si falta se genera en `DATA_DIR/secret.key`) |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Usuario inicial (solo la primera vez) |
| `COOKIE_SECURE`, `TRUST_PROXY` | Usar `true` detrás de HTTPS / proxy inverso |

## Usuario AMI (`/etc/asterisk/manager.conf`)
```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[gui]
secret = SuClaveSegura
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
read = system,call,log,agent,user,config,command,reporting,cdr,dialplan,security
write = command,reporting,config
```
`asterisk -rx "manager reload"`. La GUI solo hace consultas; no modifica Asterisk.

## Dirección de las llamadas (entrante / saliente / interna)
Si el campo `userfield` del CDR contiene `incoming`/`outgoing` (palabras configurables) se usa directamente; si no, se deduce con reglas editables en **Configuración → Dirección de llamadas** (patrones de canal de troncal, contextos de entrada/salida y máximo de dígitos de una extensión). Se aplica al histórico (columna y filtro), al panel y a las llamadas en vivo.

## Notas sobre el histórico
- Columna de fecha: `calldate` (cdr_mysql/odbc) o `start` (cdr_adaptive_odbc); se detecta sola.
- Use un usuario de base de datos de solo lectura.
- Las grabaciones se asocian a cada llamada por `uniqueid`/`linkedid` en el nombre del archivo (MixMonitor, FreePBX) o por la columna indicada en Configuración → Base de datos.
- El usuario del sistema que ejecuta la GUI debe poder leer los directorios de grabaciones (p. ej. grupo `asterisk`).

## Probar sin Asterisk
```bash
npm run mock    # AMI simulado en 127.0.0.1:5039 (gui / gui-secret) + demo/master.db + grabaciones de ejemplo
```
En Configuración: AMI `127.0.0.1:5039`; BD tipo SQLite `demo/master.db`; directorio `demo/recordings`.

## Servicio systemd (ejemplo)
```ini
[Unit]
Description=Asterisk Console
After=network.target asterisk.service

[Service]
WorkingDirectory=/opt/asterisk-gui
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.js
User=asterisk
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
Para exponerlo fuera del servidor, póngalo detrás de HTTPS (nginx/caddy) con `COOKIE_SECURE=true` y `TRUST_PROXY=true`.
