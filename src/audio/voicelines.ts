import type { HeroId } from '../game/types';
import type { VoiceChain } from '../core/Audio';

/**
 * Every line each legend can say. All lines are original writing.
 *
 * Lines are recorded with ElevenLabs text to speech (`node scripts/sfx/voices.mjs`) into
 * `src/assets/voice/<heroId>/<id>.ogg`, which the game picks up at build time. A line
 * without a recording still shows as a subtitle. `[bracketed]` words are delivery
 * directions for the voice actor: they are spoken as performance, never shown.
 */
export type VoiceEvent =
  | 'matchStart' | 'primary' | 'secondary' | 'secondaryHit' | 'ult' | 'ultEnemy'
  | 'kill' | 'multiKill' | 'death' | 'respawn' | 'ultReady' | 'lowHp' | 'victory' | 'defeat'
  | 'assist' | 'revenge' | 'streak' | 'heal' | 'takeLead' | 'behind' | 'matchPoint' | 'overtime'
  | 'enemyUlt' | 'allyDown' | 'shutdown';

export interface Line { id: string; text: string }
export interface Banter { id: string; vs: HeroId; text: string; reply: string }
export interface HeroVoice {
  short: string;
  chain: VoiceChain;
  /** ElevenLabs voice and the direction prefixed to every line when recording. */
  tts: { voice: string; direction: string; stability: number; style: number };
  lines: Partial<Record<VoiceEvent, Line[]>>;
  /** Kill lines aimed at a specific rival legend (used instead of a generic kill line sometimes). */
  rival: Partial<Record<HeroId, Line[]>>;
  banter: Banter[];
}

const L = (ev: VoiceEvent, ...texts: string[]): Line[] => texts.map((text, i) => ({ id: `${ev}_${i + 1}`, text }));
const R = (vs: HeroId, ...texts: string[]): Line[] => texts.map((text, i) => ({ id: `rival_${vs}_${i + 1}`, text }));

/** Subtitle text: the performance directions are for the voice actor only. */
export const spoken = (t: string) => t.replace(/\[[^\]]*\]\s*/g, '').trim();

export const VOICES: Record<HeroId, HeroVoice> = {
  steve: {
    short: 'Steve',
    // plain and close, a touch of crunch: a quiet builder, not a showman
    chain: { hp: 120, lp: 11000, drive: 0.06, slap: 0, slapMix: 0, reverb: 0.08, rate: 1, gain: 1.05 },
    tts: { voice: 'iP95p4xoKVk53GoZ742B', direction: '[calm, friendly young builder, understated, dry humour]', stability: 0.5, style: 0.45 },
    lines: {
      matchStart: L('matchStart', 'Alright. Day one. Let\'s get to work.', '[calm] Sword\'s sharp, bow\'s strung. Ready.', 'New world, same plan: build, fight, survive.', '[dry] Nobody touch my blocks.'),
      primary: L('primary', 'Hyah!', '[calm] Got you lined up.', 'Steady... and loose.'),
      secondary: L('secondary', 'Building up!', '[calm] One wall, coming up.', 'Need cover? I\'ve got blocks.', 'High ground, here we go.'),
      secondaryHit: L('secondaryHit', 'Good wall. Good wall.', '[pleased] Bounced right off it.'),
      ult: L('ult', '[intense] The End is here!', '[shouting] Dragon! Go!', '[intense] Out of the portal, big guy!'),
      ultEnemy: L('ultEnemy', '[intense] Look up!', '[shouting] Run, it\'s hungry!'),
      kill: L('kill', 'Crafted. Done.', '[dry] Back to spawn with you.', 'That\'s one less creeper.', '[calm] Mined.', 'And they\'re out.', '[pleased] Easy, like punching a tree.', 'Respawn point\'s that way.'),
      multiKill: L('multiKill', '[excited] Full inventory of knockouts!', '[laughs] Stack of them!', 'Two for one. Efficient.'),
      death: L('death', '[groans] Lost all my stuff...', '[sighs] Should\'ve built a roof.', '[strained] Fell in lava. Basically.'),
      respawn: L('respawn', 'Back at spawn. Let\'s try that again.', '[calm] New life, new plan.', 'Okay. Gear up.'),
      ultReady: L('ultReady', '[calm] The portal\'s humming. Dragon\'s ready.', 'I can feel the End calling.', '[excited] Dragon egg\'s about to hatch.'),
      lowHp: L('lowHp', '[alarmed] Hearts are low! Need food!', '[strained] Half a heart left!', '[panicked] Gotta dig in!'),
      victory: L('victory', '[pleased] Victory. Time to build a trophy room.', 'We won. Who wants cake?', '[calm] Game beaten. Credits roll.'),
      defeat: L('defeat', '[sighs] Back to the drawing board. And the crafting table.', 'Next world will go better.'),
      assist: L('assist', 'Nice. Teamwork.', 'I softened them up.', 'Good hit.'),
      revenge: L('revenge', '[dry] I remember your face. It\'s blocky too, right?', 'Payback, one block at a time.', '[calm] Even now.'),
      streak: L('streak', '[excited] On a roll! Nobody stop me!', 'Look at that tally.', '[pleased] Speedrun pace.'),
      heal: L('heal', 'Ah, golden apple.', 'Hearts back up.'),
      takeLead: L('takeLead', 'We\'re ahead. Keep building.', '[calm] Lead\'s ours. Don\'t get greedy.'),
      behind: L('behind', '[serious] We\'re behind. Time to dig in.', 'Okay. New strategy.'),
      matchPoint: L('matchPoint', '[intense] One more and we win!', 'Match point. Let\'s finish it.'),
      overtime: L('overtime', 'Overtime? Night\'s falling, stay close.', 'Extra time. I\'m good with that.'),
      enemyUlt: L('enemyUlt', '[alarmed] Big one incoming!', '[shouting] Take cover!'),
      allyDown: L('allyDown', 'We lost one!', '[serious] Man down. I\'ll cover.'),
      shutdown: L('shutdown', '[dry] Streak broken. Like a block.', 'Your run ends here.'),
    },
    rival: {
      einstein: R('einstein', '[dry] Physics? I just stack blocks.', 'Science is great. Swords are faster.'),
      yeat: R('yeat', 'Your bell\'s getting smelted.', '[dry] Should\'ve put the truck in a garage.'),
      vangogh: R('vangogh', 'Nice painting. I\'ll hang it in my house.', '[calm] Starry night, meet the End.'),
      blitzcrank: R('blitzcrank', 'Just a fancy iron golem.', '[dry] I\'ve fought bigger furnaces.'),
      luffy: R('luffy', 'Stretchy. Still goes down.', '[laughs] Should\'ve brought a boat.'),
      ironman: R('ironman', '[dry] Iron armor. Cute. Mine\'s diamond.', 'I mine that stuff, you know.'),
      mickey: R('mickey', 'Back to the cartoon, little guy.', '[calm] Square beats round.'),
      steve: R('steve', 'Hey, I\'m the original!', '[dry] Nice skin. Default, though.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Doc, can you explain how a block floats in the air?', reply: 'I cannot. And it bothers me deeply.' },
      { id: 'vs_ironman', vs: 'ironman', text: 'Nice armor. I could craft that with enough iron.', reply: 'You really couldn\'t. But I admire the confidence.' },
      { id: 'vs_luffy', vs: 'luffy', text: 'Want to go treasure hunting? I know where the diamonds are.', reply: 'Diamonds?! Yeah! Can we eat them?' },
      { id: 'vs_mickey', vs: 'mickey', text: 'You\'re not blocky at all. How do you even move?', reply: 'Rubber hose, pal! Bend anywhere!' },
    ],
  },
  yeat: {
    short: 'Yeat',
    // a little grit, a slapback and a touch of pitch-down: produced, not studio-clean
    chain: { hp: 110, lp: 14000, drive: 0.3, slap: 0.085, slapMix: 0.2, reverb: 0.16, rate: 0.97, gain: 1.05 },
    tts: { voice: 'TxGEqnHWrfWFTfGW9XjX', direction: '[laid back, young rapper, confident drawl]', stability: 0.35, style: 0.7 },
    lines: {
      matchStart: L('matchStart', '[hyped] Bells on. Let\'s get it.', 'Whole lobby finna hear this.', '[smug] Twizzy in the building. Act right.', 'Turn it up. We outside.'),
      primary: L('primary', 'Ring ring.', '[laughs] You hear that? That\'s you losin\'.', 'Ding ding.'),
      secondary: L('secondary', '[shouting] Tonka time!', 'Beep beep, move.', '[hyped] I\'m the truck now.', 'Outta the way!'),
      secondaryHit: L('secondaryHit', '[laughs] Got \'em on the bumper.', 'Roadkill.', 'Hit and run, baby.'),
      ult: L('ult', '[menacing whisper] Sky goin\' green...', '[shouting] Look up!', '[hyped] Bell\'s comin\' down!'),
      ultEnemy: L('ultEnemy', '[menacing] The Bell tolls for you!', '[shouting] Y\'all hear that? That\'s the end.'),
      kill: L('kill', 'Rang his bell.', 'Lights out, bells on.', '[laughs] Too loud for you.', 'That\'s 2093 behavior.', 'Sit down.', '[smug] Easy. Too easy.', 'Bell rung. Next.'),
      multiKill: L('multiKill', '[hyped] Whole squad on silent.', '[laughing] They can\'t keep up with the bells.', '[shouting] Who next? Who next?!'),
      death: L('death', '[annoyed] Nah... that was rigged.', 'Bell\'s off. For now.', '[groans] Lag. Had to be lag.'),
      respawn: L('respawn', 'Back. Louder.', 'Can\'t mute me.', '[hyped] Round two, let\'s go.'),
      ultReady: L('ultReady', '[smug] Bell\'s ready. Somebody finna get got.', 'Big bell loaded. Say the word.', '[hyped] Sky about to turn green.'),
      lowHp: L('lowHp', '[panicked] I\'m cooked, I\'m cooked.', '[nervous] Need a heal, like, now.', 'Bro I\'m one tap!'),
      victory: L('victory', '[hyped] Told y\'all. Bells don\'t lie.', '[laughs] Ring the bell, we won.', 'Easy money.'),
      defeat: L('defeat', '[sighs] Run it back.', '[annoyed] That ain\'t it.'),
      assist: L('assist', 'We cookin\'.', 'Good look.', 'Teamwork, twin.'),
      revenge: L('revenge', '[smug] Remember me?', '[laughs] Told you I\'d be back.', 'Payback\'s loud.'),
      streak: L('streak', '[hyped] I\'m on fire right now!', 'Can\'t nobody stop the bell.', '[laughs] They keep runnin\' it up to me.'),
      heal: L('heal', 'Ahh. Back to full.', 'Topped up.'),
      takeLead: L('takeLead', '[hyped] We up now! Keep goin\'!', 'Lead\'s ours. Don\'t fumble.'),
      behind: L('behind', '[serious] Lock in, we down bad.', 'We gotta turn this around.'),
      matchPoint: L('matchPoint', '[hyped] One more! Close it out!', 'Match point. Ring it.'),
      overtime: L('overtime', '[hyped] Overtime? Say less.', 'Bonus round. My favorite.'),
      enemyUlt: L('enemyUlt', '[shouting] Watch out, they poppin\' off!', '[panicked] Move, move, move!'),
      allyDown: L('allyDown', 'We lost one!', '[annoyed] Bro went down.'),
      shutdown: L('shutdown', '[laughs] Streak over. Sit down.', 'Not on my watch.'),
    },
    rival: {
      ironman: R('ironman', '[laughs] Tin can got rung.', 'Big suit, small bell.'),
      einstein: R('einstein', '[laughs] Do the math on that one.', 'Big brain, still lost.', 'Relativity? Relatively dead.'),
      vangogh: R('vangogh', '[laughs] Paint that.', 'Frame that one, Vinny.', 'Starry night? Lights out.'),
      yeat: R('yeat', 'Only one Twizzy, bro.', '[smug] Copycat got rung.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Big brain, small ears. Hear this.', reply: 'I hear it. I would rather not.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Bro got one ear, he can\'t even hear the bell.', reply: 'I heard it. I simply chose not to care.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Two Twizzys? Somebody gotta go.', reply: 'Then ring the bell, twin.' },
    ],
  },
  einstein: {
    short: 'Einstein',
    // warm and a little vintage
    chain: { hp: 90, lp: 9000, drive: 0.06, slap: 0, slapMix: 0, reverb: 0.14, rate: 1, gain: 1 },
    tts: { voice: 'JBFqnCBsd6RMkjVDRZzb', direction: '[elderly professor, strong German accent, playful]', stability: 0.45, style: 0.55 },
    lines: {
      matchStart: L('matchStart', 'A fine day for a thought experiment.', 'Let us run the experiment.', '[chuckles] Time is relative. Yours is short.', 'Imagination will take us everywhere. Starting here.'),
      primary: L('primary', 'Light, at your service.', 'Photons, away!'),
      secondary: L('secondary', '[excited] Mind the curvature!', 'Spacetime, fold!', 'Gravity is not optional.', 'Fall in, please.'),
      secondaryHit: L('secondaryHit', '[chuckles] Caught in the well.', 'Ah, the apple falls.'),
      ult: L('ult', '[shouting] E equals m c squared!', '[shouting] Mass... becomes... energy!'),
      ultEnemy: L('ultEnemy', '[menacing] Brace yourselves. This will be relatively painful!', '[shouting] Observe the equation!'),
      kill: L('kill', 'Relatively easy.', 'Your theory has been disproven.', 'Elegant, like a good proof.', 'A simple equation.', '[chuckles] Peer reviewed.', 'Q, E, D.'),
      multiKill: L('multiKill', '[excited] The results are conclusive!', '[laughs] A chain reaction!', '[excited] Fascinating! Again!'),
      death: L('death', '[sighs] Ach. A miscalculation.', 'I forgot to carry the one.', '[groans] Entropy wins this round.'),
      respawn: L('respawn', 'Back from the fourth dimension.', 'Revised, and resubmitted.', 'A new hypothesis.'),
      ultReady: L('ultReady', 'The equation is complete.', '[excited] My formula is ready!', 'All the energy I need.'),
      lowHp: L('lowHp', '[worried] My hypothesis... requires a medic!', '[nervous] I am losing mass here!', 'This experiment is going badly!'),
      victory: L('victory', '[chuckles] As predicted.', 'The math was always on our side.', 'A beautiful result.'),
      defeat: L('defeat', '[sighs] Back to the chalkboard.', 'A failed experiment is still data.'),
      assist: L('assist', 'A fine collaboration.', 'Together, we are greater than the sum.', 'Good work, colleague.'),
      revenge: L('revenge', '[chuckles] I recalculated.', 'The second trial went better.', 'Science corrects itself.'),
      streak: L('streak', '[excited] The data keeps agreeing with me!', 'A perfect series.', '[laughs] Is anyone checking my work?'),
      heal: L('heal', 'Ah. Restored to equilibrium.', 'Much better.'),
      takeLead: L('takeLead', 'The numbers favor us now.', '[pleased] We lead. Do not get careless.'),
      behind: L('behind', 'We must rethink our approach.', '[serious] The numbers are against us. For now.'),
      matchPoint: L('matchPoint', 'One more variable to solve.', '[excited] We are so close to proof!'),
      overtime: L('overtime', 'Time dilates. How fitting.', '[chuckles] Extra time? Relativity at work.'),
      enemyUlt: L('enemyUlt', '[urgent] Take cover! Their energy is spiking!', '[shouting] Incoming! Scatter!'),
      allyDown: L('allyDown', 'We have lost a colleague!', '[worried] Our numbers are down!'),
      shutdown: L('shutdown', 'Your streak has collapsed.', '[chuckles] Every curve comes down.'),
    },
    rival: {
      ironman: R('ironman', '[chuckles] All that armor, and still subject to physics.', 'Your reactor obeys my equation.'),
      yeat: R('yeat', '[chuckles] Silence, at last.', 'Your bell is out of tune.', 'Noise, cancelled.'),
      vangogh: R('vangogh', 'Sorry, Vincent. Physics beats paint.', '[chuckles] A still life now.', 'Even the stars must fall.'),
      einstein: R('einstein', '[chuckles] Only one genius per universe.', 'Imitation is not a theory.'),
    },
    banter: [
      { id: 'vs_yeat', vs: 'yeat', text: 'Mr. Yeat, your music violates several laws of physics.', reply: 'Good. Laws are mid.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Vincent, paint me a black hole.', reply: 'Only if you sit still, Albert.' },
      { id: 'vs_einstein', vs: 'einstein', text: 'Two of me? This disproves everything.', reply: 'Or proves everything. Fascinating.' },
    ],
  },
  vangogh: {
    short: 'Van Gogh',
    // soft and dreamy: more room
    chain: { hp: 100, lp: 12000, drive: 0, slap: 0, slapMix: 0, reverb: 0.28, rate: 1, gain: 1 },
    tts: { voice: 'N2lVS1w4EtoT3dr4eOWO', direction: '[passionate painter, Dutch accent, intense]', stability: 0.4, style: 0.6 },
    lines: {
      matchStart: L('matchStart', 'Let\'s put some color on this canvas.', '[dreamy] The light is perfect today.', 'Brushes ready. Let\'s paint.', '[intense] I feel a masterpiece coming.'),
      primary: L('primary', 'A little cadmium yellow!', 'Bold strokes!'),
      secondary: L('secondary', '[joyful] Grow, my sunflower!', 'Bloom for me.', 'A little life, here.'),
      secondaryHit: L('secondaryHit', 'The sunflower sees you.', '[laughs] Petals and pain.'),
      ult: L('ult', '[shouting] Look up. The stars are burning!', '[awed] The night swirls for me!'),
      ultEnemy: L('ultEnemy', '[menacing] Behold... the starry night!', '[shouting] Let the stars fall!'),
      kill: L('kill', 'A masterpiece.', 'You\'ve been framed.', 'Another study, finished.', 'Too many swirls for you.', '[satisfied] Signed, Vincent.', 'Hang that in a gallery.'),
      multiKill: L('multiKill', '[excited] My finest gallery!', '[laughs] A whole exhibition!', '[intense] The canvas is full!'),
      death: L('death', '[weakly] The colors... fade...', '[sighs] Unfinished...', 'A dark palette, today.'),
      respawn: L('respawn', 'A fresh canvas.', 'Begin again. Always begin again.', '[determined] More paint!'),
      ultReady: L('ultReady', '[dreamy] The night sky is ready.', 'The stars are waiting for me.', '[intense] I can feel the swirls.'),
      lowHp: L('lowHp', '[worried] I\'m losing my color here!', '[panicked] My canvas is torn!', 'Help me, quickly!'),
      victory: L('victory', '[proud] Art endures.', 'A painting worth a fortune.', '[joyful] Finally, someone appreciates my work!'),
      defeat: L('defeat', '[sighs] Even my best work went unsold.', 'Next time, brighter colors.'),
      assist: L('assist', 'We painted that together.', 'Lovely work, friend.', 'A shared canvas.'),
      revenge: L('revenge', '[intense] I paint over my mistakes.', 'Now it is my turn.', 'You owed me a portrait.'),
      streak: L('streak', '[excited] I cannot stop painting!', 'The inspiration flows!', '[laughs] Another, and another!'),
      heal: L('heal', 'Ah. The color returns.', 'Fresh paint.'),
      takeLead: L('takeLead', '[joyful] Our picture is taking shape!', 'We lead. Keep the strokes steady.'),
      behind: L('behind', 'This sketch needs work.', '[determined] We can still save this painting.'),
      matchPoint: L('matchPoint', 'One final brushstroke!', '[intense] Finish the masterpiece!'),
      overtime: L('overtime', 'The paint is still wet!', '[laughs] More time to create.'),
      enemyUlt: L('enemyUlt', '[urgent] Careful, something is coming!', '[shouting] Run, friends!'),
      allyDown: L('allyDown', 'We lost a friend!', '[sad] One less color.'),
      shutdown: L('shutdown', 'Your streak is painted over.', 'Not so loud now.'),
    },
    rival: {
      ironman: R('ironman', 'Red and gold. A lovely palette. A pity.', '[sighs] Even iron rusts, my friend.'),
      yeat: R('yeat', '[satisfied] Finally, some quiet.', 'Ring that, young man.', 'A still life, with bell.'),
      einstein: R('einstein', 'Your equation lacked color, Albert.', '[laughs] Relative to me, you lost.', 'Beauty beats logic.'),
      vangogh: R('vangogh', 'A forgery. Obviously.', '[laughs] Only the original survives.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Albert, can your equations explain the stars like I can?', reply: 'Yes. But yours are prettier.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Your bells are loud, young man. My colors are louder.', reply: 'Colors can\'t ring, though.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Another Vincent? Which of us is the forgery?', reply: 'Let the canvas decide.' },
    ],
  },
  mickey: {
    short: 'Mickey',
    // an old optical soundtrack: band-limited, a little crackly drive and a bright, sped-up lilt
    chain: { hp: 260, lp: 6200, drive: 0.22, slap: 0, slapMix: 0, reverb: 0.1, rate: 1.06, gain: 1.05 },
    // a designed/premade cheerful high-pitched cartoon voice (never a clone): pick one on the account when recording
    tts: { voice: 'jBpfuIE2acCO8z3wKNLl', direction: '[cheerful, high-pitched 1920s cartoon mouse, bouncy and polite]', stability: 0.35, style: 0.75 },
    lines: {
      matchStart: L('matchStart', '[cheerful] Hot dog! Let\'s have some fun, pals!', '[excited] All aboard! Next stop, victory!', '[whistles] Ha-ha! Ready when you are, fellas!'),
      primary: L('primary', 'Catch!', '[laughs] Heads up!', 'Spud\'s up!'),
      secondary: L('secondary', 'Down the hatch!', '[giggles] Now you see me...', 'Pardon me, comin\' through!'),
      secondaryHit: L('secondaryHit', '[laughs] Surprise!', 'Boing!', 'Peekaboo!'),
      ult: L('ult', '[shouting] Toot toot! All aboard!', '[excited] Full steam ahead!', '[shouting] Steamboat comin\' through!'),
      ultEnemy: L('ultEnemy', '[shouting] Clear the deck, fellas!', '[excited] Here comes the steamboat!'),
      kill: L('kill', '[laughs] Ha-ha! Gotcha!', 'Oh boy, that was swell!', 'Spud-tacular!', '[giggles] Sorry, pal!', 'Out like a light!', 'That\'s how we do it on the river!'),
      multiKill: L('multiKill', '[excited] Gee whiz, look at \'em all!', '[laughing] Hot dog! What a show!', '[excited] Swell! Who\'s next?'),
      death: L('death', '[groans] Aw, gee...', '[annoyed] Oh, nuts.', '[dizzy] Ooh, I\'m seein\' stars...'),
      respawn: L('respawn', 'I\'m back, pals!', '[cheerful] Can\'t keep a good mouse down!', '[laughs] Ha-ha! Round two!'),
      ultReady: L('ultReady', '[excited] Steam\'s up! Ready to sail!', 'Boiler\'s hot! Just say the word!'),
      lowHp: L('lowHp', '[nervous] Uh-oh, I\'m in a pickle!', '[panicked] Yikes! Help, fellas!'),
      victory: L('victory', '[cheerful] Hot dog! We did it!', '[laughs] Ha-ha! What a swell game!'),
      defeat: L('defeat', '[sighs] Aw, shucks.', 'Gosh... we\'ll get \'em next time.'),
      assist: L('assist', 'Swell teamwork!', 'Nice one, pal!'),
      revenge: L('revenge', '[smug] Remember me, pal?', '[laughs] Payback, cartoon style!'),
      streak: L('streak', '[excited] Oh boy, I\'m on a roll!', '[laughs] Can\'t stop this mouse!'),
    },
    rival: {
      einstein: R('einstein', 'Sorry, professor! Spuds beat science!', '[laughs] Bonk! Relatively speaking!'),
      yeat: R('yeat', 'Nice bell, pal! My whistle\'s louder!', '[giggles] Ding dong, you\'re gone!'),
      vangogh: R('vangogh', '[laughs] Now that\'s a cartoon, Vincent!', 'Gosh, sorry about the frame!'),
      mickey: R('mickey', 'Hey! There\'s only one of me!'),
      blitzcrank: R('blitzcrank', '[laughs] Bonk! Steam beats steam!', 'Gee, sorry, Mr. Robot!'),
      luffy: R('luffy', '[laughs] Stretchy pal, meet a potato!', 'Gosh, you bounce better than me!'),
      ironman: R('ironman', 'Toot toot! Big shiny suit, all bonked!', '[giggles] Hot dog! Got the tin man!'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Say, professor! Can your physics explain a portable hole?', reply: 'No. And it troubles me deeply.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Swell bell, pal! Wanna hear my whistle?', reply: 'Bro sound like a teapot.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Mr. Van Gogh, could you paint me in color?', reply: 'Never. You are perfect in black and white.' },
      { id: 'vs_mickey', vs: 'mickey', text: 'Two of me? Gosh, which one\'s the original?', reply: 'Me! I\'ve been doin\' this since 1928!' },
    ],
  },
  blitzcrank: {
    short: 'Blitzcrank',
    // a boiler-room machine talking: ring-modulated, a metal comb, a little grit and a cavernous slap
    chain: { hp: 140, lp: 9000, drive: 0.25, slap: 0.06, slapMix: 0.22, reverb: 0.16, rate: 0.94, gain: 1.1, robot: 46, robotMix: 0.55 },
    tts: { voice: 'onwK4e9ZLuTAKqWW03F9', direction: '[deep booming steam-powered robot, polite, mechanical, deadpan]', stability: 0.55, style: 0.4 },
    lines: {
      matchStart: L('matchStart', 'Boilers lit. Pressure nominal.', '[cheerful] Good day. I am here to help. Mostly with punching.', 'All pistons report for duty.', '[deadpan] Scanning for opponents. Many found.'),
      primary: L('primary', 'Piston engaged.', 'Pow.', '[deadpan] Applying force.'),
      secondary: L('secondary', '[booming] Get over here, please!', 'Hand delivery!', 'Extending my reach.', '[cheerful] Come closer.'),
      secondaryHit: L('secondaryHit', '[satisfied] Package received.', 'Caught one.', '[cheerful] Hello there.'),
      ult: L('ult', '[booming] Discharging!', '[booming] Overload in three, two, one!', 'Static field, maximum output!'),
      ultEnemy: L('ultEnemy', '[booming] Prepare for discharge.', '[menacing] Your devices will now power down.'),
      kill: L('kill', 'Target recycled.', '[deadpan] Problem solved.', 'Scrap collected.', 'You have been unplugged.', '[cheerful] Thank you for your cooperation.', 'Task complete.'),
      multiKill: L('multiKill', '[booming] Efficiency rising!', 'Multiple units decommissioned.', '[cheerful] A productive day!'),
      death: L('death', '[glitching] Pressure... dropping...', 'Rebooting.', '[deadpan] Error. Too many holes.'),
      respawn: L('respawn', 'Systems restored.', '[cheerful] Back online.', 'Steam pressure rebuilt.'),
      ultReady: L('ultReady', 'Capacitors fully charged.', '[booming] Static field primed.', 'I am humming. That is a good sign.'),
      lowHp: L('lowHp', '[alarmed] Hull breach! Hull breach!', 'Leaking steam, assistance required.', '[glitching] Warning. Warning.'),
      victory: L('victory', '[cheerful] Victory computed.', 'The machine prevails.', '[booming] Pressure released. We win.'),
      defeat: L('defeat', '[deadpan] Outcome suboptimal.', 'Recalibrating for next time.'),
      assist: L('assist', 'Teamwork, logged.', 'Assist registered.', '[cheerful] Happy to help.'),
      revenge: L('revenge', '[menacing] I remember your face. I remember everything.', 'Grudge file closed.', 'Settling the account.'),
      streak: L('streak', '[booming] Engines at full steam!', 'I am on a roll. I do not have wheels, but still.', '[cheerful] Output exceeding projections!'),
      heal: L('heal', 'Repairs complete.', 'Fresh rivets.'),
      takeLead: L('takeLead', 'We lead. Maintain pressure.', '[cheerful] Numbers looking good.'),
      behind: L('behind', 'Deficit detected. Increase effort.', '[determined] More steam!'),
      matchPoint: L('matchPoint', 'One more. Finish the job.', '[booming] Final objective in sight.'),
      overtime: L('overtime', 'Overtime. I do not get tired.', '[deadpan] Extended shift accepted.'),
      enemyUlt: L('enemyUlt', '[alarmed] Danger! Large energy reading!', '[booming] Take cover!'),
      allyDown: L('allyDown', 'Ally offline.', '[alarmed] We lost one!'),
      shutdown: L('shutdown', 'Streak terminated.', '[deadpan] Your run has been switched off.'),
    },
    rival: {
      einstein: R('einstein', 'Your mass has been converted. To scrap.', '[deadpan] Relatively easy.', 'Physics, meet force.'),
      yeat: R('yeat', '[deadpan] Your bell rang. I answered.', 'Volume reduced to zero.', 'Too loud. Muted.'),
      vangogh: R('vangogh', 'You are now a still life.', '[deadpan] I do not understand art. I understand punching.'),
      ironman: R('ironman', '[deadpan] Your armor has been recycled.', 'Arc reactor, unplugged.'),
      blitzcrank: R('blitzcrank', 'Inferior model.', '[deadpan] Only one of us can be the original.'),
      mickey: R('mickey', '[deadpan] Cartoon physics disabled.', 'Mouse removed.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Doctor Einstein. Can you calculate how far I can throw you?', reply: 'Roughly. I would rather not test it.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Your music is very loud. My ears are speakers. They hurt.', reply: 'That\'s the point, bro.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Mister van Gogh, please paint me. Use a lot of brass.', reply: 'You would be a magnificent golden study.' },
      { id: 'vs_blitzcrank', vs: 'blitzcrank', text: 'Another steam golem? Running diagnostics on you.', reply: 'Diagnostics complete. You are going down.' },
    ],
  },
  ironman: {
    short: 'Iron Man',
    // a touch of helmet: band-limited, a little bite, a short metallic slap
    chain: { hp: 160, lp: 9500, drive: 0.12, slap: 0.03, slapMix: 0.12, reverb: 0.1, rate: 1, gain: 1.05 },
    tts: { voice: 'cjVigY5qzO86Huf0OWal', direction: '[cocky genius billionaire, fast, dry wit, speaking inside a metal helmet]', stability: 0.4, style: 0.65 },
    lines: {
      matchStart: L('matchStart', 'Suit\'s warm. Systems green. Let\'s make some noise.', '[smug] Relax, everyone. The expensive one is here.', 'Flight check done. Weapons hot.', '[dry] I was told there would be a challenge.'),
      primary: L('primary', 'Repulsors, online.', '[smug] Hold still.', 'Palm\'s up. Bad news for you.'),
      secondary: L('secondary', '[confident] Missiles away!', 'Pods open. Pick a number.', '[smug] Heat-seeking, and they\'re seeking you.', 'Say hello to the swarm.'),
      secondaryHit: L('secondaryHit', 'Direct hit. Obviously.', '[laughs] Six for six.', 'Tracking works. I built it.'),
      ult: L('ult', '[shouting] Unibeam, full power!', '[intense] Arc reactor, everything you\'ve got!', '[shouting] Light \'em up!'),
      ultEnemy: L('ultEnemy', '[intense] Look at the chest. Last thing you\'ll see.', '[shouting] Stand right there!'),
      kill: L('kill', 'And that\'s why I don\'t do sequels.', '[smug] Genius, one. You, zero.', 'Should\'ve read the fine print.', 'Target down. Next.', '[dry] I\'ve had tougher board meetings.', 'Scratch one.', '[laughs] Was that it?'),
      multiKill: L('multiKill', '[hyped] Look at the scoreboard! That\'s all me!', '[laughs] Buy one, get one free.', '[smug] Group discount.'),
      death: L('death', '[groans] Okay... that one dented.', '[annoyed] Rebooting. Don\'t touch anything.', '[strained] Note to self: thicker plating.'),
      respawn: L('respawn', 'New suit, same attitude.', '[confident] Mark two. Upgraded.', 'Back online. Miss me?'),
      ultReady: L('ultReady', '[confident] Arc reactor is charged. Point me at something.', 'Unibeam\'s ready. Just say when.', '[smug] Chest is glowing. That\'s a good sign.'),
      lowHp: L('lowHp', '[alarmed] Armor\'s failing, I need a breather!', '[strained] Power\'s at ten percent!', '[panicked] Hull breach! Somebody cover me!'),
      victory: L('victory', '[smug] Was there ever any doubt?', '[laughs] Somebody get me a cheeseburger.', 'Victory. Put it on my tab.'),
      defeat: L('defeat', '[sighs] Back to the workshop.', '[annoyed] I\'ll fix it in the next version.'),
      assist: L('assist', 'Nice. I softened them up for you.', 'Teamwork. Mostly my work.', 'Good hit. I\'ll allow it.'),
      revenge: L('revenge', '[smug] Remember me? I remember you.', 'Payback, with interest.', '[laughs] I keep receipts.'),
      streak: L('streak', '[hyped] I\'m on a roll! Somebody stop me! Actually, don\'t.', 'Suit\'s running hot and so am I.', '[smug] They should charge admission.'),
      heal: L('heal', 'Patched up. Good as new.', 'Systems restored.'),
      takeLead: L('takeLead', '[confident] We\'re ahead. Let\'s keep it boring for them.', 'Lead\'s ours. Don\'t get cute.'),
      behind: L('behind', '[serious] We\'re behind. Time to improvise.', 'Okay, new plan. Same genius.'),
      matchPoint: L('matchPoint', '[intense] One more and we\'re done here!', 'Match point. Finish it.'),
      overtime: L('overtime', '[smug] Overtime? I bill extra for this.', 'Extra innings. Fine by me.'),
      enemyUlt: L('enemyUlt', '[alarmed] Big energy spike, incoming!', '[shouting] Scatter! Now!'),
      allyDown: L('allyDown', 'We lost one!', '[annoyed] Man down, I\'m on it.'),
      shutdown: L('shutdown', '[smug] Streak\'s over. Sit down.', 'And the show is cancelled.'),
    },
    rival: {
      einstein: R('einstein', 'Relatively speaking, you lost.', '[smug] I read your papers. Peer reviewed.', 'E equals me, squared.'),
      yeat: R('yeat', '[dry] Ring this.', 'Your bell has a dent now.', '[laughs] Saved by the bell? Not today.'),
      vangogh: R('vangogh', 'I prefer modern art.', '[smug] Nice brushwork. Shame about the ending.', 'That\'s going in the museum.'),
      blitzcrank: R('blitzcrank', '[smug] Steam power? Adorable.', 'I\'ll put you in a museum. Right next to the toaster.'),
      luffy: R('luffy', '[smug] Stretch that.', 'Rubber doesn\'t beat physics, kid.'),
      ironman: R('ironman', '[annoyed] Knock-off armor. I could tell.', 'There can only be one genius.'),
      mickey: R('mickey', '[smug] Sorry, Mickey. Black and white was never my color.', 'Steamboat sunk.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Albert! Big fan. I fixed three of your equations, by the way.', reply: 'Fascinating. Show me your work.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Love the bell. Very... analog.', reply: 'Love the suit. Very... rented.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Vincent, want me to frame your next one in titanium?', reply: 'Gold would suit you better, I think.' },
      { id: 'vs_blitzcrank', vs: 'blitzcrank', text: 'A steam robot? I have a vacuum cleaner smarter than you.', reply: 'Your vacuum cleaner has my sympathy.' },
      { id: 'vs_ironman', vs: 'ironman', text: 'Nice suit. Who made it? Oh wait. Me.', reply: 'Then you know exactly how to break it.' },
      { id: 'vs_luffy', vs: 'luffy', text: 'Rubber arms? I\'ve got rockets. Choose wisely, kid.', reply: 'Rockets? Cool! Can I ride one?' },
    ],
  },
  luffy: {
    short: 'Luffy',
    // bright and bouncy: a little room, no grit
    chain: { hp: 120, lp: 14500, drive: 0, slap: 0, slapMix: 0, reverb: 0.14, rate: 1.03, gain: 1.05 },
    tts: { voice: 'bVMeCyTHy58xNoL34h3p', direction: '[cheerful young pirate, loud, fearless, always grinning]', stability: 0.3, style: 0.75 },
    lines: {
      matchStart: L('matchStart', '[excited] Alright! Let\'s go have an adventure!', '[laughs] Shishishi! This is gonna be fun!', 'I\'m not losing to anybody!', '[hungry] Can we eat after this? Okay, let\'s fight!'),
      primary: L('primary', 'Gum-Gum Pistol!', '[shouting] Pistol!'),
      secondary: L('secondary', '[shouting] Gum-Gum Rocket!', 'Here I come!', '[laughs] Wheee!'),
      secondaryHit: L('secondaryHit', '[laughs] Got ya!', 'Bullseye!', 'Heads up!'),
      ult: L('ult', '[laughing] Shishishi! Gear Fifth!', '[shouting] I can hear the drums!', '[joyful] Now I can do anything!'),
      ultEnemy: L('ultEnemy', '[shouting] Hey! Watch this!', '[laughing] You\'re gonna love this part!'),
      kill: L('kill', 'Down you go!', '[laughs] Shishishi! Too slow!', 'That one\'s for my crew!', 'Rubber beats you!', '[proud] Told ya I\'d win!', 'Next!'),
      multiKill: L('multiKill', '[excited] Who\'s next? Come on!', '[laughing] I could do this all day!', '[shouting] Everybody at once? Sure!'),
      death: L('death', '[groans] Ow... I\'m so hungry...', '[annoyed] Hey! No fair!', 'I\'ll get you next time!'),
      respawn: L('respawn', '[cheerful] I\'m back! Did ya miss me?', 'Okay, round two!', 'That didn\'t even hurt! ...Much.'),
      ultReady: L('ultReady', '[excited] My heart\'s drumming!', 'I feel a big one coming!', '[laughs] Ready to go wild!'),
      lowHp: L('lowHp', '[worried] I need meat! Lots of meat!', '[panicked] Okay, that one hurt!', 'Gotta bounce back!'),
      victory: L('victory', '[cheering] We did it! Party time!', '[laughs] Shishishi! Told ya!', 'Let\'s feast!'),
      defeat: L('defeat', '[sighs] I\'ll get stronger. Just watch.', 'Next time, we win. Promise.'),
      assist: L('assist', '[excited] Nice one!', 'That\'s my crew!', '[laughs] Teamwork!'),
      revenge: L('revenge', '[angry] That\'s for earlier!', 'Remember me?', 'I don\'t forget!'),
      streak: L('streak', '[laughing] Nobody can stop me!', '[excited] I\'m on a roll!', 'Keep \'em coming!'),
      heal: L('heal', '[happy] Ahh, that\'s the stuff!', 'All better!'),
      takeLead: L('takeLead', '[excited] We\'re winning! Keep going!', 'Lead\'s ours!'),
      behind: L('behind', '[determined] We\'re not done yet!', 'We can still turn this around!'),
      matchPoint: L('matchPoint', '[shouting] One more! Let\'s finish it!', 'Last one, everybody!'),
      overtime: L('overtime', '[laughs] More fighting? Yes!', 'Overtime! I love it!'),
      enemyUlt: L('enemyUlt', '[shouting] Whoa, look out!', '[urgent] Something big\'s coming!'),
      allyDown: L('allyDown', '[angry] Hey! Nobody hurts my friends!', 'Hang in there!'),
      shutdown: L('shutdown', '[laughs] Your streak\'s over!', 'Not so tough now!'),
    },
    rival: {
      einstein: R('einstein', 'Smart guy, but I hit harder!', '[laughs] Your hair\'s cooler than mine, though.'),
      yeat: R('yeat', 'Your bell\'s too loud!', '[laughs] I like your music. Still beat ya!'),
      vangogh: R('vangogh', 'Paint me a picture of meat!', '[laughs] Pretty colors!'),
      luffy: R('luffy', 'Hey! There\'s only one me!', '[confused] Wait, which one\'s the real me?'),
      mickey: R('mickey', '[laughs] Your boat\'s cool! Mine\'s cooler!', 'Shishishi! Funny mouse!'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Hey, old man! Can your science make infinite meat?', reply: 'In theory... yes. In practice, sadly no.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Your music\'s cool! Can you play at my party?', reply: 'Only if the party\'s loud.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Will you paint my Jolly Roger?', reply: 'With the brightest yellow I have.' },
      { id: 'vs_luffy', vs: 'luffy', text: 'Whoa! Are you me?', reply: 'Nope! You\'re me!' },
    ],
  },
};
/** The order heroes are numbered in for per-hero stinger variants. */
export const VOICE_INDEX: Record<HeroId, number> = { einstein: 0, yeat: 1, vangogh: 2, blitzcrank: 3, luffy: 4, ironman: 5, mickey: 6, steve: 7 };

/**
 * Arena announcer lines beyond the kill feats (recorded into src/assets/announcer/).
 * Same voice and direction as the original announcer set.
 */
export const ANNOUNCER_EXTRA: { name: string; text: string }[] = [
  { name: 'revenge', text: '[excited] Revenge!' },
  { name: 'clutch', text: '[excited] Clutch!' },
  { name: 'ultDenied', text: '[excited] Ultimate denied!' },
  { name: 'comeback', text: '[excited] What a comeback!' },
  { name: 'takeLead', text: '[excited] Your team has taken the lead!' },
  { name: 'lostLead', text: '[serious] The enemy has taken the lead.' },
  { name: 'tied', text: '[excited] All tied up!' },
  { name: 'matchPoint', text: '[excited] Match point!' },
  { name: 'enemyMatchPoint', text: '[serious] Enemy match point!' },
  { name: 'oneMinute', text: '[serious] One minute remaining.' },
  { name: 'overtime', text: '[excited] OVERTIME!' },
  { name: 'finalKill', text: '[excited] And that... is the match!' },
  { name: 'playOfGame', text: '[dramatic] Play of the game!' },
  { name: 'flawless', text: '[excited] Flawless victory!' },
  { name: 'ultReady', text: '[confident] Ultimate ready.' },
  { name: 'longshot', text: '[excited] Long shot!' },
];
