'use server';

import { type CoreUserMessage, generateText } from 'ai';
import { cookies } from 'next/headers';
import OpenAI from "openai";
import { createWorker } from 'tesseract.js';

import { customModel } from '@/lib/ai';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import { VisibilityType } from '@/components/visibility-selector';

export async function saveModelId(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('model-id', model);
}

const tesseractRecognize = async (imagePath: string) => {
  const worker = await createWorker('eng');

  try {
    const {
      data: { text },
    } = await worker.recognize(imagePath);
    return text;
  } catch (error) {
    console.error(error);
    return null;
  } finally {
    await worker.terminate();
  }
};

export async function generateTitleFromUserMessage({
  message,
}: {
  message: CoreUserMessage;
}) {
  const { text: title } = await generateText({
    model: customModel('gpt-4o-mini'),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}

export async function processImages(imagePaths: any) {
  console.log('Starting to process images...');

  const imageMessages = imagePaths?.map((imagePath: string) => ({
    type: "image_url",
    image_url: {
      url: imagePath,
      detail: "high"
    }
  })) || [];

  const tesseractTexts = await Promise.all(imagePaths?.map(async (imagePath: string) => tesseractRecognize(imagePath)) || []);

  const prompt = `
I want your help with organizing my finances. I am sharing screenshots of my credit card transactions from the RBC mobile app. To make sure you don’t miss any transactions, I’ve made sure every screenshot includes one transaction from the previous screenshot, to help you capture all transactions reliably and skipping duplicates which may be occuring in multiple screenshots. Do not let these duplicates into our calculations. I’m attaching these screenshots for you. Give me the transactions in it in JSON format.
The JSON should have these columns -
* date (yyyy/MM/dd)
* description
* amount

Here's what the Tesseract OCR software recognized from the screenshot. Use it to improve your accuracy -
${tesseractTexts.join("\n")}
`;
  try {
    const client = new OpenAI();
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { "type": "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            ...imageMessages
          ],
        },
      ],
    });

    console.log('Received response from OpenAI API');
    return JSON.parse(response.choices[0].message?.content as any);
  } catch (error) {
    console.error(`Error processing image:`, error);
  }
}

// Function to count transactions per date
// async function countTransactions(imagePaths, originalFilenames) {
//   console.log('Starting to count transactions...');

//   const imageMessages = imagePaths.map(imagePath => {
//     console.log(`Processing image for counting: ${imagePath}`);
//     const imageBuffer = fs.readFileSync(imagePath);
//     const base64Image = imageBuffer.toString('base64');

//     return {
//       type: "image_url",
//       image_url: {
//         url: `data:image/jpeg;base64,${base64Image}`,
//         detail: "high"
//       }
//     };
//   });

//   const prompt = `
// I want your help with organizing my finances. I am sharing screenshots of my credit card transactions from the RBC mobile app. To make sure you don’t miss any transactions, I’ve made sure every screenshot includes one transaction from the previous screenshot, to help you capture all transactions reliably and skipping duplicates which may be occuring in multiple screenshots. I’m attaching these screenshots for you. I want you to provide me a JSON response where the key is the date (yyyy/MM/dd) and the value is the number of transactions on that date.
// `;
//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o",
//       response_format: { "type": "json_object" },
//       messages: [
//         {
//           role: "user",
//           content: [
//             {
//               type: "text",
//               text: prompt,
//             },
//             ...imageMessages
//           ],
//         },
//       ],
//     });

//     console.log('Received response from OpenAI API for counting');
//     return JSON.parse(response.choices[0].message.content);
//   } catch (error) {
//     console.error(`Error counting transactions:`, error);
//   }
// }
