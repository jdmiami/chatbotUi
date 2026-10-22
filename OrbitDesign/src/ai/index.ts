/**
 * Where any AI plugs in. Nothing here is required: the package runs with no adapter at all.
 *
 *   const brain = { ...httpChatBrain({ url, model, key }), ...webSpeech() };
 *   <OrbCursor brain={brain} />           // the orb thinks with it
 *   setWriter(writerFromBrain(brain));    // the walkthrough's predictions and script rewrites use it too
 */
export type { OrbBrain } from '../orb';
export type { Writer, ChatMessage } from '../walkthrough';
export { httpChatBrain } from './httpChat';
export { localChatBrain } from './localChat';
export { webSpeech, canSpeak, canListen, createSpeaker, speakable, unlockSpeech, listen } from './webSpeech';
export { writerFromBrain } from './bridge';
