export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Universal Subtitle Parser:
 * Supports WebVTT (.vtt), SubRip (.srt), and Advanced SubStation Alpha (.ass / .ssa)
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  if (!content || !content.trim()) return [];

  // Check if ASS / SSA format
  if (content.includes('[Events]') && content.includes('Dialogue:')) {
    return parseASS(content);
  }

  // Parse standard WebVTT or SRT
  return parseWebVTT(content);
}

/**
 * Parses standard WebVTT or SRT text into timed subtitle cues
 */
export function parseWebVTT(vttContent: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = vttContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;
  const timeRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})/;

  const parseTime = (h: string | undefined, m: string, s: string, ms: string): number => {
    const hours = h ? parseInt(h, 10) : 0;
    const minutes = parseInt(m, 10);
    const seconds = parseInt(s, 10);
    const milliseconds = parseInt(ms, 10);
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(timeRegex);

    if (match) {
      const start = parseTime(match[1], match[2], match[3], match[4]);
      const end = parseTime(match[5], match[6], match[7], match[8]);
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        // Strip HTML / VTT tags like <c.yellow>, <b>, <i>, <font ...>
        const cleanText = lines[i]
          .replace(/<[^>]+>/g, '')
          .replace(/\{[^}]+\}/g, '')
          .trim();
        if (cleanText) textLines.push(cleanText);
        i++;
      }
      if (textLines.length > 0 && end > start) {
        cues.push({
          start,
          end,
          text: textLines.join(' ')
        });
      }
    } else {
      i++;
    }
  }

  return cues;
}

/**
 * Parses Advanced SubStation Alpha (.ass / .ssa) subtitle dialogues
 */
function parseASS(assContent: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = assContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const parseAssTime = (tStr: string): number => {
    const parts = tStr.trim().split(':');
    if (parts.length < 3) return 0;
    const hours = parseInt(parts[0], 10) || 0;
    const mins = parseInt(parts[1], 10) || 0;
    const secs = parseFloat(parts[2]) || 0;
    return hours * 3600 + mins * 60 + secs;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('Dialogue:')) continue;

    // Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const parts = line.substring(9).split(',');
    if (parts.length >= 10) {
      const start = parseAssTime(parts[1]);
      const end = parseAssTime(parts[2]);
      const rawText = parts.slice(9).join(',');
      // Strip ASS override tags like {\an8}, {\c&H...&}, \N, \n
      const cleanText = rawText
        .replace(/\{[^}]+\}/g, '')
        .replace(/\\N/gi, ' ')
        .replace(/\\n/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (cleanText && end > start) {
        cues.push({ start, end, text: cleanText });
      }
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Built-in synchronized subtitle cues for demo & offline playback across languages
 */


/**
 * Returns active cue for given timestamp
 * @param cues Subtitle cues
 * @param currentTime Video current time in seconds
 * @param offsetSeconds User subtitle delay offset in seconds (±100ms)
 * @param isDemo Whether this is a local demo fallback (which can loop cues)
 */
export function getActiveCue(
  cues: SubtitleCue[],
  currentTime: number,
  offsetSeconds = 0,
  isDemo = false
): string | null {
  if (!cues || cues.length === 0) return null;

  const adjustedTime = currentTime + offsetSeconds;
  if (adjustedTime < 0) return null;

  if (isDemo) {
    const maxEnd = cues[cues.length - 1].end;
    const lookupTime = maxEnd > 0 && adjustedTime > maxEnd ? (adjustedTime % maxEnd) : adjustedTime;
    const match = cues.find((c) => lookupTime >= c.start && lookupTime <= c.end);
    return match ? match.text : null;
  }

  // Exact timeline lookup for real media subtitles from Jellyfin
  const match = cues.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);
  return match ? match.text : null;
}
