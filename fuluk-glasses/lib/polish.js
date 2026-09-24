import { LanguageModel } from 'language-model';

const POLISH_PROMPT = `你是Fuluk Gateway手机APP的语音勘错助手。Fuluk用于管理AI编程会话（Codex、Claude、OpenCode、Pi OS、Runtime），用户语音多为编程指令、改代码、调试报错和会话管理。

按产品术语纠错：
- “绘画”通常应为“会话”（如查看会话、新建会话、切换会话、会话列表），除非明确指图片。
- “却认”应为“确认”，“同以”应为“同意”，“挺止”应为“停止”，“重起”应为“重启”，“运形”应为“运行”，“代马”应为“代码”。
- 保留术语：会话、会话ID、权限、允许、放行、拒绝、terminal、tmux、编译、构建、提交、分支、仓库、接口、日志、进程。

要求：修正错字、断句、标点，保持原意和命令语气，不扩写，不补内容。只输出整理后的文字。`;

let sessionPromise = null;

async function getSession() {
  if ((await LanguageModel.availability()) !== 'available') return null;
  if (!sessionPromise) {
    sessionPromise = LanguageModel.create({
      initialPrompts: [{ role: 'system', content: POLISH_PROMPT }],
    }).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export async function polishTranscript(rawText) {
  const text = rawText.trim();
  if (!text) return '';
  try {
    const session = await getSession();
    if (!session) return text;
    const polished = await session.prompt(text);
    return (polished || text).trim();
  } catch (error) {
    console.log('polish failed, use raw transcript:', error);
    return text;
  }
}
