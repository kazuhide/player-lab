import shaka from "shaka-player/dist/shaka-player.dash-es2021.js";
import { makeShakaAdapter } from "./shaka-shared";

export const createAdapter = makeShakaAdapter(shaka, "dash");
