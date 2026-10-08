import { z } from "zod";
import type { Server } from "./context.js";

const imageArg = z.string().describe("Image URL or local file path");

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: Server) {
  server.registerPrompt(
    "redesign_room",
    {
      title: "Redesign a room",
      description: "Restyle a room photo in a chosen design style (2 variations).",
      argsSchema: { image: imageArg, style: z.string().optional().describe('e.g. "Scandinavian", "Mid-Century Modern"') },
    },
    ({ image, style }) =>
      userPrompt(
        `Redesign the room in ${image}${style ? ` in ${style} style` : ""} with luw_interior_design, 2 variations.` +
          (style ? " Check the style name with luw_list_options first if unsure it's valid." : " Pick a style that suits the space and say which one you chose.") +
          " Show me the results and briefly describe what changed.",
      ),
  );

  server.registerPrompt(
    "stage_empty_room",
    {
      title: "Virtually stage an empty room",
      description: "Furnish an empty room photo for a listing.",
      argsSchema: {
        image: imageArg,
        room_type: z.string().optional().describe('e.g. "Living Room", "Bedroom"'),
        style: z.string().optional(),
      },
    },
    ({ image, room_type, style }) =>
      userPrompt(
        `Virtually stage the empty room in ${image} using luw_interior_design with empty_room=true` +
          `${room_type ? `, room_type "${room_type}"` : ""}${style ? `, style "${style}"` : ""}. ` +
          "Keep it realistic and listing-ready (precision 75), make 2 variations and show them.",
      ),
  );

  server.registerPrompt(
    "sketch_to_render",
    {
      title: "Render a sketch",
      description: "Turn a sketch or drawing into a photorealistic render.",
      argsSchema: { image: imageArg, style: z.string().optional() },
    },
    ({ image, style }) =>
      userPrompt(
        `Turn the sketch in ${image} into a photorealistic render with luw_sketch_to_render${style ? ` in ${style} style` : ""}. ` +
          "Look at the sketch first to describe the space accurately in the prompt.",
      ),
  );

  server.registerPrompt(
    "product_shot",
    {
      title: "Product marketing shot",
      description: "Put a product photo into a new generated scene.",
      argsSchema: { image: imageArg, scene: z.string().describe('e.g. "on a travertine coffee table in a sunlit living room"') },
    },
    ({ image, scene }) =>
      userPrompt(`Create a marketing shot of the product in ${image}: use luw_background with the prompt "${scene}". Show me the result.`),
  );
}
