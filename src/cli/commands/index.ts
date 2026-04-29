import { apiCmd } from "./api.ts";
import { configCmd } from "./config/index.ts";
import { dmCmd } from "./dm.ts";
import { downloadCmd } from "./download.ts";
import { postCmd } from "./post/index.ts";
import { readCmd } from "./read.ts";
import { searchCmd } from "./search.ts";
import { statsCmd } from "./stats.ts";
import { syncCmd } from "./sync.ts";
import { userCmd } from "./user.ts";

export const COMMANDS = Object.freeze({
  config: configCmd,
  read: readCmd,
  post: postCmd,
  dm: dmCmd,
  download: downloadCmd,
  user: userCmd,
  search: searchCmd,
  api: apiCmd,
  sync: syncCmd,
  stats: statsCmd,
});

export type CommandName = keyof typeof COMMANDS;

export const COMMAND_NAMES: readonly CommandName[] = Object.freeze<CommandName[]>([
  "config",
  "read",
  "post",
  "dm",
  "download",
  "user",
  "search",
  "api",
  "sync",
  "stats",
]);
