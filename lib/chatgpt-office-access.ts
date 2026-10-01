import "server-only";

export type ChatGptOfficeAccess = {
  email: string;
  password: string;
  requestMessage: string;
};

const fallbackEmail = "office@bekzatmuratuly.kz";

export function getChatGptOfficeAccess(): ChatGptOfficeAccess | null {
  const email = process.env.MEASURER_CHATGPT_EMAIL?.trim() || fallbackEmail;
  const password = process.env.MEASURER_CHATGPT_PASSWORD;
  if (!password) return null;
  return {
    email,
    password,
    requestMessage: "Здравствуйте! Я сейчас выполняю вход в рабочий ChatGPT для замера ALTYN SAPA. Пожалуйста, подтвердите вход и отправьте код, если он появится.",
  };
}
