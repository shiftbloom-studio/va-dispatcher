import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

export function defaultGatewayFromRoute(routeText) {
  for (const line of routeText.trim().split("\n").slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination !== "00000000" || !gateway || gateway === "00000000") {
      continue;
    }
    if (!/^[0-9a-fA-F]{8}$/.test(gateway)) continue;
    const bytes = Buffer.from(gateway, "hex");
    return `${bytes[3]}.${bytes[2]}.${bytes[1]}.${bytes[0]}`;
  }
  return "";
}

export function candidateHosts(routeText) {
  const hosts = ["127.0.0.1"];
  const gateway = defaultGatewayFromRoute(routeText);
  if (gateway && gateway !== "127.0.0.1") hosts.push(gateway);
  hosts.push("host.docker.internal");
  return hosts;
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, family: 4 });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function main() {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Usage: resolve-service-host.mjs <port>");
    process.exit(1);
  }

  let routeText = "";
  try {
    routeText = readFileSync("/proc/net/route", "utf8");
  } catch {
    routeText = "";
  }

  const hosts = candidateHosts(routeText);
  for (const host of hosts) {
    if (await canConnect(host, port)) {
      process.stdout.write(host);
      return;
    }
  }

  console.error(
    `No reachable service host on port ${port}. Tried ${hosts.join(", ")}.`,
  );
  process.exit(1);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
