export interface RoleLikeMessage {
  role: string;
}

export interface ConversationRound {
  start: number;
  end: number;
}

export function collectConversationRounds<T extends RoleLikeMessage>(
  messages: T[],
  startIndex: number = 0
): ConversationRound[] {
  const rounds: ConversationRound[] = [];
  let index = Math.max(0, startIndex);

  while (index < messages.length) {
    while (index < messages.length && messages[index]?.role !== 'user') {
      index += 1;
    }

    if (index >= messages.length) {
      break;
    }

    const start = index;
    index += 1;

    while (index < messages.length && messages[index]?.role !== 'user') {
      index += 1;
    }

    rounds.push({
      start,
      end: index
    });
  }

  return rounds;
}

export function sliceRecentConversationRounds<T extends RoleLikeMessage>(
  messages: T[],
  roundCount: number,
  startIndex: number = 0
): T[] {
  if (roundCount <= 0) {
    return [];
  }

  const rounds = collectConversationRounds(messages, startIndex);
  if (rounds.length === 0) {
    return [];
  }

  const recentRounds = rounds.slice(-roundCount);
  const first = recentRounds[0];
  const last = recentRounds[recentRounds.length - 1];
  return messages.slice(first.start, last.end);
}
