// Every Engineering Lab, the real-infrastructure labs that can't run here yet, and lookups. Pure data.
import { architectureLabs } from "./labs/architecture.ts";
import { networkingLabs } from "./labs/networking.ts";
import { structuresLabs } from "./labs/structures.ts";
import type { FutureLab, Lab, StageLink, Subject } from "./model.ts";

export const labs: Lab[] = [...networkingLabs, ...structuresLabs, ...architectureLabs];

export const findLab = (subject: string, id: string) => labs.find((lab) => lab.subject === subject && lab.id === id);
export const labById = (id: string) => labs.find((lab) => lab.id === id);
export const labsFor = (subject: Subject) => labs.filter((lab) => lab.subject === subject);
/** Labs a track's unit points to, as optional extras. */
export const labsForStage = (track: StageLink["track"], stage: string) => labs.filter((lab) => lab.stages.some((s) => s.track === track && s.stage === stage));

/** Need a real operating system, server process or raw socket: listed honestly, not imitated. */
export const futureLabs: FutureLab[] = [
  { id: "linux-terminal", title: "Linux terminal", subject: "networking", needs: "A real Linux kernel, processes and file system.", localPath: "Any Linux machine, WSL on Windows, or a container: docker run -it --rm ubuntu bash." },
  { id: "tcp-sockets", title: "TCP sockets and packet capture", subject: "networking", needs: "Raw sockets and packet capture, which browsers don't give web pages.", localPath: "nc -l 8080 in one terminal, nc localhost 8080 in another; watch with Wireshark or tcpdump -i lo port 8080." },
  { id: "tls-certificates", title: "TLS certificates", subject: "networking", needs: "A server process you control and certificate tooling.", localPath: "openssl s_client -connect example.com:443 -servername example.com shows a real certificate chain." },
  { id: "firewalls", title: "Firewalls", subject: "networking", needs: "Kernel packet filtering (nftables, Windows Firewall).", localPath: "A Linux VM with nftables; test rules with nc and curl from another machine." },
  { id: "nginx", title: "Nginx and Apache configuration", subject: "architecture", needs: "A real web server process reading real configuration files.", localPath: "docker run --rm -p 8080:80 -v $PWD/nginx.conf:/etc/nginx/nginx.conf:ro nginx, then curl -i localhost:8080." },
  { id: "app-servers", title: "Node.js and ASP.NET Core servers", subject: "architecture", needs: "A server runtime listening on a real port.", localPath: "node server.js or dotnet new web && dotnet run, then call it with curl." },
  { id: "databases", title: "PostgreSQL, SQL Server and Redis", subject: "architecture", needs: "Real database servers with storage.", localPath: "docker run --rm -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres, then psql; docker run --rm -p 6379:6379 redis, then redis-cli." },
  { id: "docker-kafka", title: "Docker, Kafka and cloud deployment", subject: "architecture", needs: "Container runtimes, brokers and cloud accounts.", localPath: "Docker Desktop or Podman on your machine; Kafka through its official container image." },
];
