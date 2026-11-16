// Kitab's three Playgrounds: one list for Home, the selection page (/playground) and tests. Each opens its own
// existing tool; nothing here runs a simulation.
import { Binary, Waypoints, Workflow } from "lucide-react";

export const PLAYGROUNDS_PATH = "/playground";

export type PlaygroundId = "network" | "structures" | "architecture";

export const playgrounds = [
  {
    id: "network",
    title: "Network Playground",
    subject: "Networking",
    path: "/practice/network",
    Icon: Waypoints,
    summary: "Build a network, send a request and watch every packet cross it: ARP, switching, routing, DNS, TCP and HTTP.",
    explore: ["Add devices and cables, then break one setting", "Predict each device's decision before it happens", "Compare two runs side by side"],
  },
  {
    id: "structures",
    title: "Data Structures & Recursion Playground",
    subject: "Data structures & recursion",
    path: "/practice/structures",
    Icon: Binary,
    summary: "Run any operation on arrays, linked lists, stacks, queues, hash tables, trees and graphs, or watch a recursion fill the call stack.",
    explore: ["Step through every read, write and pointer change", "Edit the starting values and chain operations", "Push and pop call-stack frames, with or without a base case"],
  },
  {
    id: "architecture",
    title: "Architecture Playground",
    subject: "System design & architecture",
    path: "/practice/architecture",
    Icon: Workflow,
    summary: "Design an application from APIs, databases, caches, load balancers and queues, then send simulated traffic through it.",
    explore: ["Start from a template or a blank canvas", "Find the bottleneck as traffic grows", "Watch failures spread, then design them out"],
  },
] as const;
