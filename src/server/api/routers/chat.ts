import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const getAIResponse = (message: string): string => {
	const lowerMsg = message.toLowerCase();

	if (lowerMsg.includes("add") || lowerMsg.includes("create")) {
		return "I can help you add that feature! Here's what I'll implement:\n\n1. Create the necessary components\n2. Add the required navigation\n3. Style it to match your app\n\nWould you like me to proceed with these changes?";
	}

	if (lowerMsg.includes("color") || lowerMsg.includes("style")) {
		return "Great choice! I can update the styling for you. I'll modify the theme colors and ensure everything looks consistent across your app. The changes will be reflected immediately in your Expo Go preview.";
	}

	if (lowerMsg.includes("help") || lowerMsg.includes("what")) {
		return "I'm here to help you build your Expo app! I can:\n\n• Add new screens and navigation\n• Implement features like forms, lists, maps\n• Change colors, fonts, and styling\n• Add integrations with APIs\n• Set up state management\n\nJust describe what you'd like to add or change!";
	}

	return `I understand you want to work on: "${message}"\n\nLet me help you implement this feature. I'll make the necessary code changes to your Expo project and you'll see the updates in real-time through Expo Go.\n\nShould I proceed with implementing this?`;
};

export const chatRouter = createTRPCRouter({
	sendMessage: publicProcedure
		.input(
			z.object({
				sessionId: z.string().min(1),
				message: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			// Simulate AI processing time
			await new Promise((resolve) =>
				setTimeout(resolve, 1000 + Math.random() * 2000),
			);

			return {
				response: getAIResponse(input.message),
				sessionId: input.sessionId,
			};
		}),
});
