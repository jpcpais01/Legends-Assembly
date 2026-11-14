export interface PatchNote {
  version: string;
  date: string; // ISO
  title: string;
  sections: { heading: string; items: string[] }[];
}

/** Player-facing patch notes. Newest first. Every merge to main adds an entry. */
export const PATCH_NOTES: PatchNote[] = [
  {
    version: '0.21.4',
    date: '2026-11-14',
    title: 'Gum-Gum Voice',
    sections: [
      {
        heading: 'Luffy',
        items: [
          'Luffy finally speaks! Every line is now fully voiced: his battle cries for Gum-Gum Pistol, Rocket and Gear Fifth, his trash talk, his reactions when he takes a hit or loses a teammate, and his banter with the other legends.',
        ],
      },
    ],
  },
  {
    version: '0.21.3',
    date: '2026-11-14',
    title: "Mickey's New Look",
    sections: [
      {
        heading: 'Mickey Mouse',
        items: [
          'Mickey has his final model: big round ears, red shorts, yellow shoes and a proper cartoon grin, with his bouncy rubber-hose walk on top.',
          'Steamboat Willie now sends a real wooden paddle steamer down the lane, puffing smoke from both funnels and squashing on every chug.',
          'Spud Shot throws an actual potato now. Look closely: it has a little face.',
        ],
      },
      {
        heading: 'Fixes',
        items: ['The start screen now lists all seven legends.'],
      },
    ],
  },
  {
    version: '0.21.2',
    date: '2026-11-14',
    title: 'Iron Man Suits Up',
    sections: [
      {
        heading: 'Iron Man',
        items: [
          'Iron Man now wears his real armor: a fully detailed red and gold suit with a glowing arc reactor, eye slits and back flaps, replacing the stand-in suit.',
          'Missile Swarm fires proper micro-missiles now: sleek red and gold rockets with gold nose cones and swept fins.',
        ],
      },
    ],
  },
  {
    version: '0.21.1',
    date: '2026-11-14',
    title: 'The Real Straw Hat',
    sections: [
      {
        heading: 'Luffy',
        items: [
          'Luffy gets his real look: a fully detailed new model replaces the stand-in, with the red vest, blue shorts, sandals, scar and his trademark grin. His stretchy punches, rocket grabs and giant Gear Fifth fists all work with the new body.',
          'Gear Fifth now opens with a proper giant straw hat spinning above him as the drums of liberation kick in.',
        ],
      },
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-14',
    title: 'Steamboat Willie',
    sections: [
      {
        heading: 'New legend: Mickey Mouse, The Original Toon (Duelist)',
        items: [
          'Mickey joins the roster as he first appeared in 1928: black and white ink, pie-cut eyes, big shoes and a bounce in every step. He even bops along to a tune only he can hear while standing still.',
          'Spud Shot (LMB): lob potatoes that drop right onto your crosshair. Headshots land with a BONK! and 50% more damage, and a miss bounces once to try again.',
          'Portable Hole (RMB): slap a hole on the floor, dive in with a slide whistle and burrow up to 16 m to where you aim. You pop out with a stomp that bonks everyone nearby into the air. Great for escaping, and even better for jumping someone.',
          'Steamboat Willie (SHIFT): pull the whistle cord and the whole match turns into a scratchy 1928 black-and-white cartoon, while a giant paddle steamer comes chugging down your crosshair and launches everyone in its path. A calliope plays it in.',
          'Bots play Mickey too: they burrow under you for the stomp, escape through holes when hurt, and line up the steamboat on groups.',
        ],
      },
      {
        heading: 'Sound',
        items: ['Mickey brings a full cartoon sound set: slide whistles, woodblock bonks, rubbery bounces, a riverboat steam whistle, a chugging paddle wheel and an original calliope tune.'],
      },
      {
        heading: 'Coming soon',
        items: ["Mickey's final model and his potato and steamboat models are on the way. His voice lines show as subtitles until they're recorded."],
      },
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-14',
    title: 'Iron Man Joins the Assembly',
    sections: [
      {
        heading: 'New legend: Iron Man (Duelist)',
        items: [
          'Repulsor Blast (LMB): alternating palm blasts that fly fast and straight. His arm locks out toward the crosshair and the palm flares on every shot. Headshots deal 50% bonus damage.',
          'Missile Swarm (RMB): the shoulder pods flip open and fire six homing missiles at the enemy closest to your crosshair. They corkscrew in on smoke trails and splash on impact.',
          'Unibeam (Shift): he lifts off, the arc reactor charges, and a huge beam pours out of his chest. Sweep it across the arena: it burns through every enemy in its path and scorches the floor where it lands. He takes 30% less damage while it runs.',
          'Jet Boots (passive): hold jump in the air to hover on your boot thrusters. A fuel bar under the crosshair shows how much flight is left, and it refills on the ground.',
          'His own crosshair, footsteps that clank like armor, and plenty to say: lines and banter with Einstein, Yeat, Van Gogh, Blitzcrank and Luffy (shown as subtitles until his voice is recorded).',
          'Bots play him too: they hop onto their jet boots mid-fight, fire missiles at whoever they can see, and save the Unibeam for crowds or tough targets.',
        ],
      },
      {
        heading: 'Coming soon',
        items: ['Iron Man is wearing a stand-in suit for now. His full detailed armor arrives in a later update.'],
      },
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-14',
    title: 'Gum-Gum',
    sections: [
      {
        heading: 'New legend: Monkey D. Luffy, the Rubber Pirate (Duelist)',
        items: [
          'Gum-Gum Pistol (LMB): his fists stretch out to whatever you aim at, up to 21 m, and snap back like a rubber band. Alternate hands, 40 damage, headshots deal 50% more.',
          'Gum-Gum Rocket (RMB): both arms shoot out, grab a wall or an enemy, and slingshot him in. Anyone in the way gets body-slammed for 75 and launched. Works as an escape too.',
          'Gear Fifth (SHIFT): the Drums of Liberation. He floats up as the drums quicken, then bursts out white in a ring of clouds that throws nearby enemies back. For 10 seconds his fists turn giant and splash, he runs faster, bounces higher, takes less damage, and his Rocket recharges twice as fast.',
          'His arms really stretch: it is his own body, stretched by the rig, not a special effect.',
          'He plays with a stand-in body until his full model arrives. His lines show as subtitles until they are recorded.',
          'Bots can play Luffy and use his whole kit.',
        ],
      },
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-14',
    title: 'Full Steam Ahead',
    sections: [
      {
        heading: 'New legend: Blitzcrank, the Great Steam Golem',
        items: [
          'A brass Vanguard who decides who is in the fight. 425 health, long arms, a short temper and very good manners.',
          'Power Fist (LMB): alternating piston jabs with a lunge behind each one. Every third blow is an uppercut that launches the target into the air.',
          'Rocket Grab (RMB): his fist rockets out on a chain, clamps the first enemy it meets and reels them back to him, stunned. A caught enemy primes your next punch into the uppercut.',
          'Static Field (SHIFT): the boilers overload, both fists hammer the floor and a lightning shockwave shocks, slows and silences everyone around him. For 6 seconds after, stray bolts jump to anyone who stays close.',
          'He has his own robot voice, footsteps, steam vents and a full set of new punch, grab and slam animations. Bots play him too.',
        ],
      },
      {
        heading: 'Combat',
        items: [
          'New status: Silenced. Silenced legends cannot use RMB or SHIFT abilities, and static crackles over their body while it lasts.',
          'New status: Stunned. Stunned legends cannot move or act for a moment, and little sparks circle their head.',
        ],
      },
    ],
  },
  {
    version: '0.17.1',
    date: '2026-11-14',
    title: 'Gallery Walls',
    sections: [
      {
        heading: 'Grand Museum',
        items: [
          'The walls are no longer one column bay repeated: velvet-draped arches, a marble chariot relief, a lion head fountain and bronze doors with a pediment behind each spawn now alternate with the painted arches.',
          'The upper storey mixes the laurel niches with an arched gallery loggia over the staircases, golden rose windows and painted sky panels.',
        ],
      },
    ],
  },
  {
    version: '0.17.0',
    date: '2026-11-14',
    title: 'Assemble Together',
    sections: [
      {
        heading: 'Play online with friends',
        items: [
          'Create a party on the home screen and send the invite link (or the 5-letter code). Your friend clicks it, or types the code into Join, and lands in your party.',
          'Up to 10 players in one match: 1v1, 2v2, 3v3 or 5v5. Play together on one team or against each other. Bots fill every empty seat.',
          'Hero select shows both teams live: everyone’s pick, who has locked in, and a Switch team button. The match moves on when every player is locked in.',
          'Your own legend answers instantly on your screen, your shots land where you saw them land, and the host keeps everyone’s health, eliminations and score in step.',
          'No account and no download: it connects browser to browser. If a player drops, a bot takes over their legend so the match can finish.',
          'After the match, Back to party takes everyone straight into the next hero select.',
        ],
      },
      {
        heading: 'Pick the arena last, load it in place',
        items: [
          'The arena is now picked after your lineup is set, solo and in a party, on a new arena screen with a preview of each map.',
          'Choosing an arena no longer reloads the whole game. It loads in place behind a new versus screen that shows both teams.',
        ],
      },
    ],
  },
  {
    version: '0.16.3',
    date: '2026-11-14',
    title: 'Click Fix',
    sections: [
      {
        heading: 'Fixes',
        items: [
          'Lock In on hero select takes mouse clicks again. Before, only Enter would start the match.',
          'The pause menu shows Leave match again, and Resume, Settings and How to play now do what they say instead of trying to leave the match.',
          'Clicking the arena to jump back in after a pause works reliably: an invisible HUD layer was swallowing those clicks.',
        ],
      },
    ],
  },
  {
    version: '0.16.2',
    date: '2026-11-14',
    title: 'Museum Treasures',
    sections: [
      {
        heading: 'New in the Grand Museum',
        items: [
          'A blue whale skeleton now hangs on steel cables high over the east half of the hall, swaying ever so slightly.',
          'Four golden pharaoh sarcophagi stand behind velvet ropes near the spawn corners. They are tall, solid cover as you leave your base.',
          'Crimson velvet benches face the paintings: low cover you can vault, right in the lanes.',
        ],
      },
    ],
  },
  {
    version: '0.16.1',
    date: '2026-11-14',
    title: 'Farewell, Sunset Ruins',
    sections: [
      {
        heading: 'Arenas',
        items: [
          "The Sunset Ruins are gone for good. Matches now play in the Giant's Study or the Grand Museum.",
          "If the Ruins were your last pick, you'll land in the Giant's Study instead.",
        ],
      },
      {
        heading: 'Under the hood',
        items: ['The ruins meadow, its props and its ambience no longer download, so the game loads a little lighter.'],
      },
    ],
  },
  {
    version: '0.16.0',
    date: '2026-11-14',
    title: 'The Grand Museum',
    sections: [
      {
        heading: 'A new arena: the Grand Museum',
        items: [
          'A colossal marble museum hall with its dome broken open to the sky. Pick it on the home screen (Arena: Museum).',
          'Sunlight slants through the windows of the shattered dome in long golden shafts that cross the hall, with dust drifting in the beams.',
          'Two tiers of gilded columns and laurel niches line the walls, under a coffered ceiling, with 24 paintings hanging in the arches (look for a starry night, the sunflowers, a chalked E = mc² and a glowing green bell).',
          'The floor is polished inlaid marble: a giant compass rose under the dome, a red and gold runner down the nave, and real reflections of the hall in the polish.',
        ],
      },
      {
        heading: 'How it plays',
        items: [
          'The T-rex skeleton holds the middle. You can weave between its legs and under its ribs, and its plinth is cover.',
          'Two winged victories and two rearing bronze riders on tall pedestals guard the lanes around it.',
          'A grand staircase on each long wall climbs to a balcony landing: high ground that overlooks the whole crossing.',
          'An arched gallery screen shields each spawn, and the column alcoves along the walls are cover you can step into.',
        ],
      },
      {
        heading: 'Under the hood',
        items: [
          "The museum's textures stay compressed on your graphics card (KTX2), using several times less video memory, and every repeated piece is drawn in one go.",
        ],
      },
    ],
  },
  {
    version: '0.15.1',
    date: '2026-11-14',
    title: 'Hall of Sound',
    sections: [
      {
        heading: 'The Assembly Hall, heard',
        items: [
          'The Assembly Hall now sounds like a vast stone hall: a deep, airy drone and a long echo of its own, instead of the study’s fireplace and ticking clocks.',
          'Hero select has its own music: a pulse that builds while you choose, crossfading back to the menu theme when you leave.',
          'Locking in makes the music swell, and a shimmer rings out each time a new legend steps onto the stage.',
          'When a match starts the hall fades out and the arena’s own sounds take over, and they hand back to the hall when you return to the menus.',
        ],
      },
    ],
  },
  {
    version: '0.15.0',
    date: '2026-11-14',
    title: 'Assembly Hall',
    sections: [
      {
        heading: 'A stage of their own',
        items: [
          'The menus no longer stand your legend in the middle of the battle map. They now pose in the Assembly Hall: a floating obsidian dais under a beam of light, a turning gilded armillary halo, a ring of dark obelisks with glowing seams and a painted nebula sky.',
          'The whole hall takes on your legend’s colours, easing between them when you switch: icy blue for Einstein, hot pink for Yeat, sunflower gold for Van Gogh.',
          'Locking in makes the hall flare: the halo flashes, a light wave runs across the floor and the beam spikes.',
        ],
      },
      {
        heading: 'New hero select',
        items: [
          'Hero select is rebuilt like a real hero shooter: your team down the left, your legend big and centre stage, their kit on the right, the roster grouped by role along the bottom and Lock In bottom right.',
          'Your bot teammates pick one after another while you choose, and the match uses exactly the team you saw. If a teammate held the legend you switch to, they swap.',
          'Hover or click an ability to preview what it does, with its key, stats and description.',
          'Locking in stamps the button, wipes a band of your legend’s colour across the screen and ticks every teammate as locked.',
        ],
      },
      {
        heading: 'Home screen',
        items: [
          'Reorganised around the stage: game modes as cards on the left (the selected one shows what it is about), the latest patch top right, your legend’s nameplate under the dais with a Change legend shortcut (L), and bot skill, arena and a bigger Play button bottom right.',
          'Arrow keys up and down now switch game modes.',
        ],
      },
      {
        heading: 'HUD, rebuilt with care',
        items: [
          'Health: a bigger number, a segmented bar with a gloss, a warm chunk that drains after you take damage and a green ghost that leads the bar when you are healed.',
          'Abilities: cleaner tiles with a cooldown sweep and edge line, a big countdown, and a flash plus an expanding ring the moment one is ready again.',
          'Special: a segmented ring that fills in your legend’s colour with the charge in the middle. When it is full the ring turns, the icon lights up and a “Special ready” call pops above it.',
          'Hit markers are four crisp ticks: white for hits, gold for headshots, red with a ring burst for eliminations.',
          'Eliminations under the crosshair are now a red badge with the name, assists in blue. Kill feed rows got team colour edges and skewed portraits, and your own kills are outlined.',
          'Score: sharper team panels, a bump when the score changes, and fallen teammates’ portraits are struck through until they respawn.',
          'Fixed: the special ring’s charge arc did not show, and kill feed rows for specials could break onto several lines.',
        ],
      },
      {
        heading: 'Menus',
        items: [
          'Settings and the other pages use solid panels instead of blurred glass, which is sharper and cheaper to draw.',
        ],
      },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-11-14',
    title: 'Surround Sound',
    sections: [
      {
        heading: 'Music that follows the fight',
        items: [
          'New recorded score: a warm theme behind the menus, and three match cues that move with the action.',
          'A tense, ticking underscore while nobody is fighting, driving battle music once the shooting starts, and an all-out finale in the last minute, at match point and in overtime.',
          'When a special goes off, the music drops out under it and swells back bigger.',
        ],
      },
      {
        heading: 'A room you can hear',
        items: [
          "The Giant's Study is now full of sound, placed where it comes from: the fire crackling on its wall, wind and rain at the windows, birds and a far-off city drifting in, old beams creaking overhead and the chandelier chain groaning as it sways.",
          "The pocket watch ticks in time with its second hand, the metronome clicks on every swing and the Newton's cradle clacks each time its balls meet. Walk close and you hear them.",
          'Everything echoes like a huge wooden library now; the ruins sound like open air between broken stone walls.',
          'The room keeps living softly behind the menus.',
        ],
      },
      {
        heading: 'Hear where things are',
        items: [
          'Every legend has their own footsteps: Einstein in old leather shoes, Yeat in heavy sneakers with a jingling chain, Van Gogh in wooden clogs.',
          'What you walk on matters: paper crunches, coins clink, book covers thud and marble clicks.',
          'Enemy footsteps are louder and carry further than your own team\'s, so you can hear someone coming round the clutter.',
          'Sounds behind you are duller than sounds in front, and anything behind a book stack or a mug comes through muffled.',
          'When you get hit, the hit comes from the direction of whoever shot you.',
        ],
      },
      {
        heading: 'Every hit lands',
        items: [
          'Big hits get a heavy punch on top of the hit tick, and eliminations end with a deep bass drop.',
          'A soft chime confirms assists.',
          'Low on health, a heartbeat creeps in and the world goes muffled around you, while your team\'s voices stay clear.',
        ],
      },
      {
        heading: 'Specials are moments',
        items: [
          'Every special is heard by everyone, anywhere on the map: a heroic stinger when your side casts one, a menacing one from the enemy\'s direction, and the caster\'s voice line.',
          'The rest of the fight ducks out of the way while it plays out.',
        ],
      },
      {
        heading: 'The match has a story',
        items: [
          'The study\'s big clock counts down the last ten seconds, each tick a little tighter.',
          'Match point gets a tense orchestral sting.',
          'The final elimination drops into slow motion with a deep time-stop whoosh before the victory or defeat fanfare.',
        ],
      },
      {
        heading: 'The Tonka, rebuilt',
        items: [
          'The Tonka now has a live V8 that follows the truck exactly: it revs up from idle as Yeat transforms, climbs through three gears with a clunk and a drop in revs at each shift, and digs in harder when you floor it.',
          'A supercharger whine rides on top at full throttle, and the exhaust pops and crackles when you lift off at the end.',
        ],
      },
      {
        heading: 'A living desk',
        items: [
          'Dust hangs in the air over the desk and glitters where the sunbeams cross it. Blasts blow it away.',
          'Embers drift up from the fireplace.',
          'Big hits jolt the desk: nearby objects shake and rattle in their own voices (china, coins, glass, pencils, paper), the whole desk booms under a special, and the chandelier swings.',
        ],
      },
    ],
  },
  {
    version: '0.13.1',
    date: '2026-11-14',
    title: 'Perpetual Motion',
    sections: [
      {
        heading: "Giant's Study",
        items: [
          "A Newton's cradle now sits at the back of the desk, between the red book and the candle: five chrome balls on a walnut stand, swinging back and forth all match long.",
          'The balls are solid, so you can duck behind them for cover.',
          'The Einstein, Van Gogh and Yeat papers, the index cards and the paper clips are staying hand-made for good.',
        ],
      },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-11-13',
    title: 'Main Event',
    sections: [
      {
        heading: 'The legends finally speak',
        items: [
          'Einstein, Yeat and Van Gogh now have real recorded voices: almost 250 lines between them, each in their own voice and style.',
          'They talk about everything: opening a match, landing kills, getting revenge, ending a streak, picking up health, taking the lead, falling behind, match point and overtime.',
          'Rivals get personal. Each legend has kill lines for the other two (and for a mirror match), and new banter pairs when legends meet at the start.',
          'Your legend shouts a warning when an enemy special goes off nearby, and reacts when a teammate goes down close by.',
        ],
      },
      {
        heading: 'A real commentator',
        items: [
          'The announcer now calls the whole match: lead taken, lead lost, all tied, comebacks, match point for either side, one minute remaining and overtime.',
          'Four new feats with their own banners and calls: Revenge (take out whoever last eliminated you), Clutch (finish a kill under 20% health), Ultimate Denied (kill someone whose special was ready) and Long Shot (a basic attack kill from over 30 m).',
          'Matches end with a call on the final blow, or a Flawless Victory if the enemy never scored.',
        ],
      },
      {
        heading: 'Match flow',
        items: [
          'New VS lineup: both teams slide in under the countdown with every player and legend.',
          'Final blow cam: when a match ends, the camera swings round the player who landed the last elimination in slow motion, letterboxed, before the results.',
          'Play of the Game: the biggest highlight of the match (multi-kills, streaks, specials) takes the spotlight on the results screen, with an announcer call.',
          'Death cam: when you are eliminated, the camera turns to show who got you before orbiting your fall.',
        ],
      },
      {
        heading: 'Combat feel',
        items: [
          'Casting your special now has a cinematic beat: the camera swings out wide, time slows for a breath and the ability name flashes between letterbox bars.',
          'When an enemy special goes off near you, a red danger warning shows who cast what, and the screen edges throb.',
          'Every shot has a little view kick that springs back (the aim itself never moves). Yeat’s bell kicks hardest.',
          'Heroes now react to where a hit comes from: blows shove the upper body along the push and it springs back, heavier hits further.',
        ],
      },
      {
        heading: 'HUD',
        items: [
          'The kill feed shows which ability got the kill. Kills with a special are marked in gold, and enemy kills are tinted red.',
          'Teammates’ special charge shows under their portraits at the top, glowing gold when it is ready.',
        ],
      },
    ],
  },
  {
    version: '0.12.3',
    date: '2026-11-13',
    title: 'Smooth Light',
    sections: [
      {
        heading: 'Performance',
        items: [
          'High and Ultra graphics run much smoother in the Giant’s Study. The god rays are now traced at half resolution with a smarter upscale, so they cost about a third of what they did on High while looking cleaner, with crisper edges around heroes and props.',
          'The sky outside is no longer painted behind the walls where nobody can see it, and the room behind the desk is drawn last, so hidden parts of it are skipped.',
          'The desk props use about 330 MB less video memory, with no visible change, which helps a lot on laptops and cards with less memory.',
        ],
      },
      {
        heading: 'Fixes',
        items: [
          'Fixed black holes appearing on shiny gold and glossy surfaces (the pocket watch, the pencil, the globe) when they caught the sun. They now gleam the way they should.',
        ],
      },
    ],
  },
  {
    version: '0.12.2',
    date: '2026-11-13',
    title: 'Toxic Toll',
    sections: [
      {
        heading: 'Yeat: The Bell',
        items: [
          'The Bell is now almost twice as big, and its blast radius grows from 6 m to 8 m.',
          'A toxic green cloudbank rolls in overhead and the bell breaks through it, pouring green smoke down onto its target while the ground starts to rumble.',
          'The toll blows a ring of toxic smoke off the bell and sends a sound wave sweeping across the arena.',
          'On the way down it tears through its own smoke, spitting sparks off its lip.',
          'The landing is a toxic mushroom cloud: a column of green and black smoke, a cap spreading over it and a skirt rolling across the floor, with layered shockwaves, a green light pillar, sparks, heavier camera shake and a big BRRRT.',
          'Green fog keeps leaking out from under the bell after it lands.',
        ],
      },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-11-13',
    title: 'Horsepower',
    sections: [
      {
        heading: 'Yeat · Tonka',
        items: [
          'Tonka has all-new sound. The transform is a crisp run of ratchets and servos that slams shut with a heavy metal clunk.',
          'The engine now has two layers: a throaty V8 rumble while cruising that builds into a full-throttle roar as the truck hits top speed. No more chipmunk revving.',
          'Tires squeal when you throw the truck into a hard turn.',
          'Ramming someone lands a much heavier crunch.',
        ],
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-11-13',
    title: 'Through the Window',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'The study is now a real, fully sculpted room: towering bookcases with a ladder, a stone fireplace, a reading chair, a window seat piled with scrolls and a carved wooden door, all closed in under a beamed ceiling.',
          'A second arched window looks out from the side wall, and both windows have clear glass you can see the sky through.',
          'Late sun now pours in through the back window: a bright patch of light, criss-crossed by the window bars, falls across the desk and the floor.',
          'Real god rays: you can see the beams of light in the air, with dust drifting through them and glinting only where the sun catches it.',
          'The fireplace glows and flickers, and the chandelier now hangs from the ceiling on a long chain.',
          'The magnifying glass and the spectacles now have real see-through lenses.',
        ],
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-13',
    title: 'Sound Check',
    sections: [
      {
        heading: 'All-new sound',
        items: [
          'Every sound in the game has been re-recorded: all nine abilities, hits, headshots, eliminations, footsteps, jumps, landings, pickups, respawns and the whole menu.',
          'Einstein’s photons zap, the Gravity Well now swirls and then implodes right on the pop, and E = mc² charges up before it detonates.',
          'Yeat’s bell riff hits with a real handbell and 808, Tonka roars and revs with speed, and The Bell tolls like a cathedral before it craters the ground.',
          'Van Gogh’s paint flicks and splats wetly, the sunflower bursts out of the earth, and The Starry Night shimmers over the arena.',
          'Footsteps match the floor: polished wood on the Giant’s Study desk, grass in the Ruins.',
          'Each arena now has its own ambience: rain, a ticking clock and a crackling fire in the Study, wind and birds in the Ruins.',
          'Rapid-fire sounds vary in pitch and level every shot, so nothing machine-guns.',
        ],
      },
      {
        heading: 'Announcer',
        items: [
          'An arena announcer calls the big moments: First Blood, Double, Triple, Quadra and Penta Eliminations, streaks (On a Streak, Rampage, Unstoppable, Legendary), Shutdown, Team Wipe, Fight, Victory and Defeat.',
          'Lock In a legend and the announcer calls “Legends… assemble!”.',
          'Multi-kills now count kills chained within 4.5 seconds, separately from your streak.',
        ],
      },
      {
        heading: 'HUD',
        items: [
          'Brand-new kill callouts: a hex badge slams in with a shockwave, the title wipes on with a light sweep, extra feats show as tags and your streak as a row of diamonds.',
          'Each feat has its own color, from gold doubles to a prismatic Penta.',
        ],
      },
    ],
  },
  {
    version: '0.10.4',
    date: '2026-11-13',
    title: 'Sand and Glass',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'Thirteen more desk pieces are now fully sculpted: the hourglass, brush jar, melted candle, coin stack, gold-rimmed teacup, crimson scroll, scarlet tome, brass spectacles, magnifying glass, ruler, sealed letter, yellow pencils and an emerald quill.',
          'The hourglass has real glass you can see through, with sand piled in the bottom bulb and still draining from the top.',
          'Fixed a rare white screen when some sculpted props were in view.',
        ],
      },
    ],
  },
  {
    version: '0.10.3',
    date: '2026-11-13',
    title: 'First Editions',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'A tall stack of gilt-spined antique books now leans on the desk’s back corner.',
          'The inkwell is a proper brass-and-glass piece with its white quill standing in it.',
        ],
      },
    ],
  },
  {
    version: '0.10.2',
    date: '2026-11-13',
    title: 'Sharper Toys',
    sections: [
      {
        heading: 'Yeat',
        items: [
          'Tonka and The Bell now use their full 2K textures, so the emerald truck and the rune-carved bell stay crisp right up close.',
          'Updated models can no longer get stuck behind an old copy saved on your device: if you ever saw the old yellow truck or plain gold bell, they are gone for good.',
        ],
      },
    ],
  },
  {
    version: '0.10.1',
    date: '2026-11-13',
    title: 'Sculpted Desk',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'The desk props are getting fully sculpted, hand-painted models, and each one swaps in as it arrives.',
          'Stacked books now sit exactly on top of each other whatever their thickness, and the candle keeps its flickering flame.',
        ],
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-13',
    title: 'Second Nature',
    sections: [
      {
        heading: 'Heroes rebuilt from the bones up',
        items: [
          'Every hero has a new skeleton, placed on their real shoulders, neck, hips and knees. Arms now hang naturally at the sides instead of sticking out.',
          'Faces no longer stretch or warp. Heads move as one solid piece, so Einstein keeps his face whatever he does.',
          'Shoulders, elbows, collars and coats bend much more cleanly, with new collarbones, an extra spine joint and toes.',
          'Heroes stand in a relaxed stance instead of a wide brace.',
        ],
      },
      {
        heading: 'Movement',
        items: [
          'Real strafing and diagonals: the hips turn into the direction of travel and the feet step where you are actually going, while the chest stays on your crosshair.',
          'A proper backpedal, upright and slightly leaning back, instead of a run played backwards.',
          'Walk, jog and sprint now match your real speed, so feet grip the ground instead of sliding.',
          'Feet stay planted while they carry weight. Turn on the spot and your hero takes real steps to follow.',
          'Heroes lean into acceleration, bank into strafes and settle when they stop.',
          'Jumps keep the arms in, and landings are softer when you are already running.',
          'Looking up and down bends the whole spine, and attacks follow it.',
        ],
      },
      {
        heading: 'Attacks and abilities',
        items: [
          'Every attack has a new hand-made motion that follows your crosshair and works at full sprint.',
          'Einstein jabs photons from alternating hands and winds up a real overhand throw for his gravity orb.',
          'Yeat cocks the bell by his head and snaps it at the target.',
          'Van Gogh slashes his brush stroke from high to low and lobs seeds with an underhand toss.',
          'New ultimate poses: Einstein floats with open arms and loose legs, and Vincent sweeps his arm up to paint the sky.',
          'Getting hit now makes heroes flinch on impact.',
        ],
      },
      {
        heading: 'Under the hood',
        items: [
          'The motion library is six times smaller, so the first load is quicker.',
          'Heroes only appear once their motion is ready, so they never flash a stiff pose.',
        ],
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-11-13',
    title: 'Fresh Varnish',
    sections: [
      {
        heading: 'A new desk',
        items: [
          'The Giant’s Study desk is rebuilt from scratch: a varnished walnut top made of glued boards, with real wood grain, knots, pores and fine scratches that stay sharp right under your feet.',
          'The desk now has rounded edges, a moulded lip, drawers with brass knobs and turned legs reaching down to the floor.',
          'The old blurry clutter that was stuck to the desk is gone. Everything on it is now a separate, detailed prop.',
        ],
      },
      {
        heading: 'New things on the desk',
        items: [
          'Einstein’s relativity notes, Vincent’s letter to Theo with a sunflower sketch, and Yeat’s session sheet, all handwritten and curling at the corners.',
          'An inkwell with a goose quill, a fountain pen, pencils, a 30 cm ruler, paper clips and a stack of index cards.',
          'A magnifying glass, round spectacles, cloth hardcovers with gilt spines, a rolled map tied with ribbon and a sealed envelope.',
          'A porcelain teacup, a lit candle in a brass holder, a stack of coins, an hourglass and a jar of paint-loaded brushes.',
          'Coffee rings and an ink splatter where the giant got careless.',
        ],
      },
      {
        heading: 'Sharper study',
        items: [
          'The bookshelves around the room are now filled with real books of every size, some leaning and some stacked, instead of a flat picture.',
          'The coffee mug, desk lamp, chess pieces, eraser and crumpled paper use twice the texture detail.',
          'The arena downloads faster too: the desk is built in code instead of a large model.',
        ],
      },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-11-13',
    title: 'Locked In',
    sections: [
      {
        heading: 'Fullscreen and mouse',
        items: [
          'Matches now open in fullscreen the moment you hit Lock In, with the mouse captured right away. You can turn this off in Settings, Controls.',
          'Esc opens the pause menu without kicking you out of fullscreen. Hold Esc if you want to leave fullscreen.',
          'The mouse now uses raw input where your browser supports it, so turning matches your hand exactly with no OS acceleration.',
          'Fixed sudden camera jerks right after the mouse gets captured or recaptured.',
          'If the mouse ever gets released mid-match (alt-tab, a browser popup), the game pauses cleanly instead of leaving a stray cursor. Click anywhere on the arena to jump back in.',
          'The cursor stays hidden over the arena for the whole match.',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-13',
    title: 'Real Motion',
    sections: [
      {
        heading: 'Motion capture',
        items: [
          'Every hero now moves with real motion capture from human actors, fitted to each hero’s own body and proportions.',
          'Walking, jogging and sprinting blend smoothly with speed, and the stride matches how fast you move, so feet plant on the ground instead of sliding.',
          'Strafing turns the hips into the run while the shoulders stay on target, and backpedaling steps backwards for real.',
          'Jumps push off and tuck in the air, landings absorb the drop (lighter when you land running), and turning on the spot takes small steps.',
          'Attacks are real throws, swings, jabs and casts on the upper body while the legs keep running, with either hand, and the striking arm reaches straight down your crosshair.',
          'Taking damage makes heroes flinch from the hit, and eliminations play a proper fall.',
        ],
      },
      {
        heading: 'Credits',
        items: ['Motion capture from the Universal Animation Library by Quaternius (CC0).'],
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-11-13',
    title: 'Clean Slate',
    sections: [
      {
        heading: 'Cleaner menus',
        items: [
          'The home screen is now one clear column: pick a mode, hit Play, and set bot skill and arena right below. Nothing overlaps anymore, on any screen size.',
          'Removed the extra cards and the clock from the home screen. What’s New now lives in a small link at the bottom left.',
          'Hero select keeps your legend’s info, the roster and Lock In in their own spaces, so the ability list never runs into the roster.',
          'How to Play drops the keyboard picture and keeps one simple list of controls.',
          'Smaller laptops and short windows get compact layouts for every menu, the pause screen and the match results.',
          'Fixed the tab highlight sometimes looking too wide when the menu first opened.',
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-12',
    title: 'Feel Every Hit',
    sections: [
      {
        heading: 'Every hit lands',
        items: [
          'Big hits now freeze the action for a split second, so heavy blows, rams and eliminations land with real weight.',
          'Every hit throws a bright impact flare and sparks in the attacker’s color, and headshots burst with a golden star.',
          'Huge moments bend the screen itself: shockwaves ripple through the air, colors split and the view punches in on blasts, slams and eliminations.',
          'Damage numbers from rapid hits on the same target now stack into one growing number, and big hits show bigger numbers.',
          'Your crosshair blooms when you fire, the hitmarker grows with the damage you deal, and eliminations flash the edges of the screen.',
          'Taking a heavy hit flashes the screen red and knocks the colors out of alignment for a moment.',
        ],
      },
      {
        heading: 'Albert Einstein',
        items: [
          'Photon Burst fires flickering light tracers with a muzzle flare, and every fifth photon is a bright quantum.',
          'Gravity Well now warps space around it: the world bends into a ring around the singularity, twin jets blast out of its poles, enemies caught in it are torn into streaks of light, and it implodes with a flash.',
          'E = mc² draws two rune circles under Einstein, pulls in energy from all around and grows a small sun in his hands before it goes off.',
          'The blast whites out the screen, sends a shockwave through the air and leaves cracked, scorched ground with drifting embers and a rising smoke column.',
        ],
      },
      {
        heading: 'Yeat',
        items: [
          'Bell Ring throws music notes off the bell with every shot, and the center ring leaves a golden streak.',
          'The Tonka has glowing headlights and red tail-light streaks, leaves skid marks in hard turns, and the screen blurs with speed as it accelerates.',
          'Ramming someone is now a comic-book smash, with stars, flying toy plastic and a wall of dust.',
          'The Bell locks a rune circle onto its target that tightens as it commits, sheds green embers, and its toll ripples through the air.',
          'When it lands it cracks the ground into a crater and throws rock and dust everywhere.',
        ],
      },
      {
        heading: 'Vincent van Gogh',
        items: [
          'Impasto Shot leaves a real brushstroke trail through the air and splashes into flying strokes of paint.',
          'The Sunflower Field is painted onto the ground in thick brushstrokes, the flower glows like a small sun, and golden motes drift to every ally it heals.',
          'The Starry Night paints a swirl of strokes across the floor, brushstrokes ride the wind inside the dome, and shooting stars now streak down with real trails.',
        ],
      },
      {
        heading: 'Everywhere else',
        items: [
          'Eliminations release a rising column of light, a rune circle and the legend’s light drifting away as stars.',
          'Respawns arrive in a beam of light, and health packs lift you up in a column of healing crosses.',
          'Healing shows rising green crosses, slowed legends shed frosty sparkles, and a legend with a ready special glows at their feet.',
          'Footsteps, jumps and landings kick up dust, and big falls send out a dust ring.',
          'Each special starts with a flare, a rune circle and a pillar of light in the legend’s color.',
          'Fixed: shockwave rings, paint stains and other effects on the floor were invisible from above. They now show up everywhere they should.',
          'New settings under Interface: Screen effects and Camera shake can each be turned off.',
        ],
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-12',
    title: 'Fighting Form',
    sections: [
      {
        heading: 'Attacks you can feel',
        items: [
          'Every attack is now a full-body move with a wind-up, a strike and a follow-through, instead of an arm snapping straight out.',
          "Einstein fires photons with quick alternating palm thrusts and hurls his gravity orb overhand from behind his head.",
          'Yeat raises his golden bell high, snaps it down and shakes it out with every ring.',
          'Van Gogh slashes paint in sweeping brush strokes and lobs his sunflower seeds underhand.',
          'The chest, hips and knees drive each strike, and the head stays locked on the target.',
        ],
      },
      {
        heading: 'More natural movement',
        items: [
          'Legends shift their weight over the planted foot as they walk, and their hips sway with it.',
          'Direction changes ripple up the spine instead of turning the whole body at once.',
          'Arms swing with relaxed elbows that bend as they come forward, and hands drift toward the middle when sprinting.',
          'Starting and stopping leans harder into the change of speed.',
          'Each legend moves like themselves: Yeat bounces with a swagger, Einstein keeps a scholarly hunch and Van Gogh tilts his head like he is sizing up a canvas.',
        ],
      },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-11-12',
    title: 'Steady Cam',
    sections: [
      {
        heading: 'Camera',
        items: [
          "The camera no longer clips through walls or book stacks when your back is against them. It now checks a whole lens-sized area instead of a single line, so corners can't sneak into view.",
          'Backing along a wall is smooth: the camera tucks in instantly when something gets in the way and glides back out instead of popping.',
          'Hugging a wall on your right side now slides the over-the-shoulder view inward instead of pushing the camera into the wall.',
          'If the camera ends up right behind your head, your legend steps out of view so you can still see the fight.',
          'Shots fired while the camera is squeezed in against a wall now start from your legend, not from past them.',
          'The camera snaps cleanly into place when you spawn and respawn.',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-12',
    title: "The Giant's Study",
    sections: [
      {
        heading: 'New arena',
        items: [
          "The Giant's Study: fight on top of a scholar's desk the size of a field, shrunk to the height of a pencil.",
          'Climb around towering book stacks, duck behind a coffee mug, a chess set and a chunky eraser, and fight over open pages and scattered paper.',
          'The study is alive: the pocket watch ticks, the globe turns, the metronome swings and the chandelier sways overhead.',
          'Sunset pours in through a tall arched window while the fireplace flickers on the far wall.',
          "Pick your arena on the home screen, next to Bot skill. The Giant's Study is the new default and the Sunset Ruins are still there.",
        ],
      },
      {
        heading: 'Yeat',
        items: [
          'The Tonka is now a green-and-gold monster truck whose wheels actually roll.',
          'Yeat carries a golden hand bell that swings and rings with every shot.',
          'The Bell got its new futuristic look.',
        ],
      },
      {
        heading: 'Bots',
        items: ['Bots find their way around obstacles instead of walking into walls.'],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-12',
    title: 'Legends Find Their Voice',
    sections: [
      {
        heading: 'All-new sound',
        items: [
          'Every sound in the game has been redesigned from scratch with richer, layered audio: punchier hits, deeper explosions and real space around every sound.',
          'Sounds now live in the arena: distant fights get softer, more muffled and more echoey, and everything pans with your camera.',
          'Footsteps for every legend, paced by their real speed, plus jump and landing sounds. Bigger falls land harder.',
          'The music sinks under a dark, muffled filter while The Bell darkens the sky, and the mix ducks around big moments so they hit harder.',
          'Pausing now hushes the battlefield.',
        ],
      },
      {
        heading: 'Ability sounds',
        items: [
          'Einstein: Photon Burst zaps and crackles on impact, Gravity Well inhales, spins up, swallows sparks and collapses with a boom, and E = mc² screams up to a blast with a golden ringing tail.',
          'Yeat: Bell Ring is now a rage bell with a distorted 808, and firing in a row plays a dark riff. Tonka ratchets, clanks, honks its air horn, and its engine revs higher the faster you drive. Ramming lands with a metal crunch and a huge 808.',
          'Yeat: The Bell rolls in with thunder, wind and a backwards toll, rings out with a colossal bronze toll, whistles as it falls, and lands with a cracked clang and an earthquake rumble.',
          'Van Gogh: Impasto Shot flicks wet paint that splats and drips, the sunflower bursts from the earth with a harp glissando, and The Starry Night swirls around you with twinkling glass. Shooting stars now whoosh and chime when they strike.',
        ],
      },
      {
        heading: 'Voice lines',
        items: [
          'Legends now talk: match openers, ability callouts, eliminations, multi-kills, low-health calls, respawns, victory and defeat.',
          'Ult callouts: hear an enemy Yeat shout "The Bell tolls for you!" and you know to move.',
          'Rival banter: when two legends meet at the start of a match, they trade lines.',
          'New subtitles show who is talking, colored for you, allies and enemies, plus a Voice lines volume slider and a Subtitles toggle in Settings.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-12',
    title: 'Center Stage',
    sections: [
      {
        heading: 'All-new menus',
        items: [
          'A brand-new console-style home screen: mode tiles across the top, a big Play button, your legend on the dais and a live clock. Switch tabs with Q and E, pick modes with the arrow keys and press Enter to play.',
          'New hero select. Your legend steps up close while their role, stats, difficulty and full kit fill the screen. Flip through the roster with A and D, then Lock In with a cinematic stamp.',
          'Redesigned Settings with Graphics, Controls, Audio, Interface and Profile pages, quality cards and smooth sliders.',
          'New Learn page with a visual control map, fundamentals and tips for the legend you play. Patch notes now live in a News tab.',
          'New pause menu with your live match stats and kit, plus a two-step Leave so you never quit by accident.',
          'New end-of-match screen: a dramatic Victory or Defeat reveal, an MVP spotlight, your personal stats counting up, full team breakdowns, and one-click Play again or Change legend.',
        ],
      },
      {
        heading: 'All-new HUD',
        items: [
          'Bigger, cleaner health readout with a damage trail, heal flash and a low-health pulse.',
          'Skewed ability slots with names, cooldown sweeps and a flash when your ability is ready. The special ring spins and glows the screen edges when it is charged.',
          'New scoreboard bar with team portraits, respawn timers and progress toward the win target.',
          'Kill feed with hero portraits, an elimination and assist ticker under your crosshair, and a death card that shows who took you out and when you respawn.',
          'Match intro card and a ring countdown before every fight. Hold Tab for a redesigned scoreboard.',
          'New Interface settings: HUD scale, crosshair color and a damage numbers toggle.',
          'The HUD only updates what changed each frame, which keeps it light on the CPU.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-12',
    title: 'Living Motion',
    sections: [
      {
        heading: 'Movement feel',
        items: [
          'All-new character motion. Feet now plant on the ground and stride with your real speed, so legends no longer skate.',
          'Running looks like running: arms pump, the pelvis and shoulders counter-twist, and the body bobs and leans with your pace.',
          'Strafing and backpedaling turn the hips toward where you are going while the chest keeps aiming at your target.',
          'Legends lean into acceleration, bank into turns and rock forward when they stop suddenly.',
          'Turning on the spot keeps your feet planted, then takes a quick step to catch up.',
        ],
      },
      {
        heading: 'Weight and impact',
        items: [
          'Jumps have a real arc: a tucked knee on the way up, legs reaching for the ground on the way down, and a squash when you land. Bigger falls land harder.',
          'Taking a hit makes your legend flinch.',
          'Attacks drive from the chest, so shots and punches have more snap.',
          'Defeated legends now buckle at the knees and topple under gravity instead of tipping over stiffly.',
          'Idle legends hold a combat stance, shift their weight and breathe.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-12',
    title: 'Legends Take Shape',
    sections: [
      {
        heading: 'Sculpted legends',
        items: [
          'Einstein, Yeat and Van Gogh now have fully sculpted, hand-textured bodies, from the cardigan and wild hair to the puffer and chains to the straw hat and paint-stained coat.',
          'Van Gogh carries his painter\'s palette into battle.',
          'Van Gogh\'s Sunflower Field now blooms a giant hand-painted sunflower.',
        ],
      },
      {
        heading: 'Yeat rework',
        items: [
          'New RMB, Tonka: Yeat turns into a speeding toy truck that keeps accelerating but turns wide. Ram an enemy for up to 140 damage. The camera pulls back while you drive.',
          'New SHIFT, The Bell: the sky turns dark and green as a colossal bell appears above your target. It tolls once, then crashes down for up to 230 damage. It tracks the target for a moment, so a sharp dodge can still escape.',
          'Rage Dash and 2093 Mode have been retired.',
        ],
      },
      {
        heading: 'Arena',
        items: [
          'Marble thinker statues now guard the four lanes into the central dais.',
          'Bronze cauldrons replace the old braziers.',
          'Ivy-covered ruined arches add cover on the north and south lanes and ring the arena\'s rim.',
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-11-12',
    title: 'Sculpted Legends Prep',
    sections: [
      {
        heading: 'Under the hood',
        items: [
          'Groundwork for the fully sculpted hero models: legends can now wear detailed, textured bodies that use the same walk, aim, cast and ultimate animations as today.',
          'Hero models are trimmed and compressed for fast downloads and smooth frame rates, even with ten legends on screen in Assembly War.',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-12',
    title: 'The Assembly Begins',
    sections: [
      {
        heading: 'New legends',
        items: [
          'Albert Einstein, The Theorist (Duelist): Photon Burst, Gravity Well, and the reality-bending E = mc² special.',
          'Yeat, The Rage Icon (Vanguard): Bell Ring sound blasts, Rage Dash, and the 2093 Mode transformation with pulsing bass drops.',
          'Vincent van Gogh, The Dreamer (Strategist): Impasto Shot paint globs, healing Sunflower Field, and The Starry Night sky dome.',
        ],
      },
      {
        heading: 'Modes',
        items: [
          '1v1 Duel, 2v2 Skirmish, 3v3 Clash and 5v5 Assembly War, with bot teammates and opponents (Easy, Normal and Hard).',
          'First team to the elimination target wins. If time runs out on a tie, it goes to sudden-death overtime.',
          'Four health pads around the arena restore 150 HP and respawn after 12 seconds.',
        ],
      },
      {
        heading: 'Arena: Sunset Ruins',
        items: [
          'A golden-hour island of marble ruins with a glowing central sigil, a lake that reflects the sky, and swaying grass that parts as heroes walk through it.',
          'Cypress groves, braziers, team banners and gates, drifting dust motes, and distant mountains fading into the haze.',
        ],
      },
      {
        heading: 'Feel and polish',
        items: [
          'Headshots deal 50% bonus damage, with hit markers, critical damage numbers and kill confirmations.',
          'Damage direction indicators, kill feed, elimination streak callouts, a live scoreboard (hold Tab) and an end-of-match MVP.',
          'Every sound is synthesized live, including Yeat’s bells, Einstein’s photon zaps and Van Gogh’s paint splats.',
          'Installable as an app (PWA), with auto-detected graphics quality and dynamic resolution to keep frame rates high.',
        ],
      },
    ],
  },
];
