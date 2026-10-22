/**
 * Where any AI plugs in. Nothing here is required: the package runs with no adapter at all.
 *
 *   const brain = { ...httpChatBrain({ url, model, key }), ...webSpeech() };
 *   <OrbCursor brain={brain} />                  // the orb thinks with it
 *   setAssistant(assistantFromBrain(brain));     // the flow's suggestions and the conversation use it too
 */
export type { OrbBrain } from '../orb';
export type { Assistant, ChatMessage } from '../flow';
export { httpChatBrain } from './httpChat';
export { localChatBrain } from './localChat';
export { webSpeech, canSpeak, canListen, createSpeaker, speakable, unlockSpeech, listen } from './webSpeech';
export { assistantFromBrain } from './bridge';
