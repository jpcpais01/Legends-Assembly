# Voice lines

Every line each legend can say in a match. All lines are original writing.

## How to add recordings

1. Record or generate each line as its own short file, trimmed tight with no silence at the start.
2. Name the file after the line id in the tables below, for example `kill_2.mp3`. mp3, ogg, wav, m4a, webm and opus all work.
3. Put it in `src/assets/voice/<hero>/`, for example `src/assets/voice/yeat/kill_2.mp3`.

The build picks the files up automatically. Lines without a recording still show as a subtitle with a short stinger. Each legend has a voice chain in `src/audio/voicelines.ts` (Yeat: grit, slapback and a slight pitch-down; Einstein: warm; Van Gogh: roomy), so clean raw takes are best. Don't add the effects yourself.

**Voicing tips:** speak in the legend's character, not as an impression of a real recording. If you use an AI voice, design a new voice (for example "young male rapper, raspy, deep, laid-back") instead of cloning a real person.

## Yeat (`src/assets/voice/yeat/`)

| File id | When | Line |
|---|---|---|
| `matchStart_1` | Match start | Bells on. Let's get it. |
| `matchStart_2` | Match start | Whole lobby finna hear this. |
| `matchStart_3` | Match start | Twizzy in the building. Act right. |
| `primary_1` | Basic attack (rare) | Ring ring. |
| `primary_2` | Basic attack (rare) | You hear that? That's you losin'. |
| `secondary_1` | Ability (RMB) | Tonka time! |
| `secondary_2` | Ability (RMB) | Beep beep, move. |
| `secondary_3` | Ability (RMB) | I'm the truck now. |
| `secondaryHit_1` | Ability lands | Got 'em on the bumper. |
| `secondaryHit_2` | Ability lands | Roadkill. |
| `ult_1` | Special (SHIFT), heard by you and allies | Sky goin' green... |
| `ult_2` | Special (SHIFT), heard by you and allies | Look up. |
| `ultEnemy_1` | Special, heard by enemies | The Bell tolls for you! |
| `kill_1` | Elimination | Rang his bell. |
| `kill_2` | Elimination | Lights out, bells on. |
| `kill_3` | Elimination | Too loud for you. |
| `kill_4` | Elimination | That's 2093 behavior. |
| `multiKill_1` | Multi-elimination | Whole squad on silent. |
| `multiKill_2` | Multi-elimination | They can't keep up with the bells. |
| `death_1` | Eliminated | Nah... that was rigged. |
| `death_2` | Eliminated | Bell's off. For now. |
| `respawn_1` | Respawn | Back. Louder. |
| `respawn_2` | Respawn | Can't mute me. |
| `ultReady_1` | Special ready | Bell's ready. Somebody finna get got. |
| `lowHp_1` | Low health | I'm cooked, I'm cooked. |
| `victory_1` | Victory | Told y'all. Bells don't lie. |
| `defeat_1` | Defeat | Run it back. |
| `vs_einstein` | Match start, vs Einstein | Big brain, small ears. Hear this. |
| `vs_vangogh` | Match start, vs Van Gogh | Bro got one ear, he can't even hear the bell. |
| `reply_einstein` | Reply to Einstein's opener | Good. Laws are mid. |
| `reply_vangogh` | Reply to Van Gogh's opener | Colors can't ring, though. |

## Einstein (`src/assets/voice/einstein/`)

| File id | When | Line |
|---|---|---|
| `matchStart_1` | Match start | A fine day for a thought experiment. |
| `matchStart_2` | Match start | Let us run the experiment. |
| `matchStart_3` | Match start | Time is relative. Yours is short. |
| `primary_1` | Basic attack (rare) | Light, at your service. |
| `secondary_1` | Ability (RMB) | Mind the curvature! |
| `secondary_2` | Ability (RMB) | Spacetime, fold! |
| `secondary_3` | Ability (RMB) | Gravity is not optional. |
| `ult_1` | Special (SHIFT), heard by you and allies | E equals m c squared! |
| `ultEnemy_1` | Special, heard by enemies | Brace yourselves. This will be relatively painful! |
| `kill_1` | Elimination | Relatively easy. |
| `kill_2` | Elimination | Your theory has been disproven. |
| `kill_3` | Elimination | Elegant, like a good proof. |
| `kill_4` | Elimination | A simple equation. |
| `multiKill_1` | Multi-elimination | The results are conclusive! |
| `death_1` | Eliminated | Ach. A miscalculation. |
| `respawn_1` | Respawn | Back from the fourth dimension. |
| `ultReady_1` | Special ready | The equation is complete. |
| `lowHp_1` | Low health | My hypothesis... requires a medic! |
| `victory_1` | Victory | As predicted. |
| `defeat_1` | Defeat | Back to the chalkboard. |
| `vs_yeat` | Match start, vs Yeat | Mr. Yeat, your music violates several laws of physics. |
| `vs_vangogh` | Match start, vs Van Gogh | Vincent, paint me a black hole. |
| `reply_yeat` | Reply to Yeat's opener | I hear it. I would rather not. |
| `reply_vangogh` | Reply to Van Gogh's opener | Yes. But yours are prettier. |

## Van Gogh (`src/assets/voice/vangogh/`)

| File id | When | Line |
|---|---|---|
| `matchStart_1` | Match start | Let's put some color on this canvas. |
| `matchStart_2` | Match start | The light is perfect today. |
| `primary_1` | Basic attack (rare) | A little cadmium yellow! |
| `secondary_1` | Ability (RMB) | Grow, my sunflower! |
| `secondary_2` | Ability (RMB) | Bloom for me. |
| `ult_1` | Special (SHIFT), heard by you and allies | Look up. The stars are burning! |
| `ultEnemy_1` | Special, heard by enemies | Behold... the starry night! |
| `kill_1` | Elimination | A masterpiece. |
| `kill_2` | Elimination | You've been framed. |
| `kill_3` | Elimination | Another study, finished. |
| `kill_4` | Elimination | Too many swirls for you. |
| `multiKill_1` | Multi-elimination | My finest gallery! |
| `death_1` | Eliminated | The colors... fade... |
| `respawn_1` | Respawn | A fresh canvas. |
| `ultReady_1` | Special ready | The night sky is ready. |
| `lowHp_1` | Low health | I'm losing my color here! |
| `victory_1` | Victory | Art endures. |
| `defeat_1` | Defeat | Even my best work went unsold. |
| `vs_einstein` | Match start, vs Einstein | Albert, can your equations explain the stars like I can? |
| `vs_yeat` | Match start, vs Yeat | Your bells are loud, young man. My colors are louder. |
| `reply_yeat` | Reply to Yeat's opener | I heard it. I simply chose not to care. |
| `reply_einstein` | Reply to Einstein's opener | Only if you sit still, Albert. |

