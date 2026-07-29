import { generateJson } from './gemini';
import { sendMessage } from './telegram';
import { renderInline } from './caption';

const QA_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

export const QA_FALLBACK_TEXT = 'Вибачте, зараз не вдалося відповісти. Спробуйте, будь ласка, трохи пізніше.';

function buildQuestionPrompt(question: string): string {
  return `Ти — хімічний асистент, що відповідає українською мовою фахівчині-хімікині з багаторічним досвідом. Дай точну, стислу відповідь на її питання.

Правила:
- Пиши для фахівчині. Називай сполуки та механізми. Не спрощуй.
- Лише українська мова. Хімічні формули пиши з нижніми індексами Unicode (H₂O, CO₂, C₆H₁₂O₆), НІКОЛИ звичайними цифрами.
- Виділяй ключові терміни та факти подвійними зірочками, наприклад **оксид алюмінію**.
- Без вступних фраз на кшталт «Звичайно, ось відповідь» — одразу по суті.
- Приблизно 400-800 видимих символів. Якщо питання не про хімію чи суміжну науку, ввічливо поясни це в одному реченні.

Питання: ${question}`;
}

// Answers a free-form chemistry question from an already-activated recipient.
// Always sends something back — a real answer, or a Ukrainian apology on
// failure — so a question never appears to be silently ignored.
export async function answerQuestion(botToken: string, apiKey: string, chatId: string, question: string): Promise<void> {
  const result = await generateJson({
    apiKey,
    model: 'gemini-flash-lite-latest',
    prompt: buildQuestionPrompt(question),
    schema: QA_SCHEMA,
    thinkingLevel: 'low',
  });

  if (result.kind !== 'ok') {
    await sendMessage(botToken, { chatId, textHtml: QA_FALLBACK_TEXT, replyMarkup: { inline_keyboard: [] } });
    return;
  }

  const { answer } = result.data as { answer: string };
  await sendMessage(botToken, { chatId, textHtml: renderInline(answer), replyMarkup: { inline_keyboard: [] } });
}
