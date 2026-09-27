import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidateHosts,
  defaultGatewayFromRoute,
} from "./resolve-service-host.mjs";

const route = [
  "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
  "eth0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  "eth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
].join("\n");

test("parses the little-endian default gateway from /proc/net/route", () => {
  assert.equal(defaultGatewayFromRoute(route), "172.17.0.1");
});

test("ignores a table with no default route", () => {
  assert.equal(
    defaultGatewayFromRoute(
      "Iface Destination Gateway\neth0 000011AC 00000000 0001",
    ),
    "",
  );
});

test("tries localhost, then the Docker host gateway, then host.docker.internal", () => {
  assert.deepEqual(candidateHosts(route), [
    "127.0.0.1",
    "172.17.0.1",
    "host.docker.internal",
  ]);
});
