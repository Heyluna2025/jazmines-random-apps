'use strict';

// Everything the three views share: the ten slides, the three activities and
// the snack-demo branches. Edit the text here and every view picks it up.

const SLIDES = [
  {
    n: 1,
    title: 'What would you love to become?',
    kicker: 'Welcome',
    lines: ['Scan the QR code to join.', 'Then tap the field you’re most curious about.'],
    activity: 'poll',
    hint: 'Open the poll as students arrive.',
  },
  {
    n: 2,
    title: 'Meet your future self',
    lines: ['Every choice up there is a real path.', 'Let’s see what this room is curious about.'],
    activity: 'poll',
    hint: 'Close the poll, then reveal the results.',
  },
  {
    n: 3,
    title: 'I had to start again',
    lines: [
      'Plans change. Businesses close. Jobs disappear.',
      'Starting again is not failure — it’s a new first step.',
      'The skills you build now come with you.',
    ],
    hint: 'Students see the waiting screen.',
  },
  {
    n: 4,
    title: 'What is AI, actually?',
    lines: [
      'A tool that predicts what comes next — words, pictures, code — by learning from millions of examples.',
      'It guesses. It doesn’t know.',
      'It’s fast, not always right.',
      'You are still the one in charge.',
    ],
    hint: 'Students see the waiting screen.',
  },
  {
    n: 5,
    title: 'One business has many jobs',
    lines: [
      'Even a small snack stall needs: planning · making · selling · counting · fixing · telling people.',
      'AI can help with some of the tasks.',
      'A person still owns the result.',
    ],
    hint: 'Students see the waiting screen.',
  },
  {
    n: 6,
    title: 'Let’s build something',
    lines: ['A snack-ordering app for a school fair.', 'Which feature should we explore together?'],
    activity: 'feature',
    hint: 'Open the vote, close it, reveal the winner, then open the demo branch.',
  },
  {
    n: 7,
    title: 'Would you trust this?',
    lines: [
      'Before trusting anything AI helped build, check it:',
      'Is the total correct?',
      'Can sold-out snacks still be ordered?',
      'Does the button do what it says?',
    ],
    activity: 'feature',
    hint: 'The winning feature stays on screen. Discussion only — no new activity.',
  },
  {
    n: 8,
    title: 'Ask clearly. Check carefully. Finish something useful.',
    columns: [
      { title: 'Ask clearly', text: 'Say exactly what you want, and for whom.' },
      { title: 'Check carefully', text: 'Test it. Read it. Try to break it.' },
      { title: 'Finish something useful', text: 'Small and done beats big and never.' },
    ],
    hint: 'Students see the waiting screen.',
  },
  {
    n: 9,
    title: 'Your first small project',
    lines: ['“I want to help ______ do ______ more easily.”', 'Fill in your card on your phone.'],
    activity: 'card',
    hint: 'Open the action-card form.',
  },
  {
    n: 10,
    title: 'What will you make possible?',
    lines: ['Save your card. Show it to someone this week.', 'Then take your first step.'],
    activity: 'card',
    hint: 'Cards stay on students’ phones. End the session when you’re done.',
  },
];

const ACTIVITIES = {
  poll: {
    id: 'poll',
    title: 'Explore your future',
    question: 'Which field are you most curious about?',
    choices: ['Creative work', 'Running a business', 'Technology', 'Helping people', 'Still figuring it out'],
    slide: 1,
  },
  feature: {
    id: 'feature',
    title: 'Choose our app feature',
    question: 'Which feature should we explore together?',
    choices: ['Choose snacks and quantities', 'See the total price', 'See which snacks are sold out'],
    slide: 6,
  },
  card: {
    id: 'card',
    title: 'My first small project',
    prompt: 'I want to help ______ do ______ more easily.',
    fields: {
      who: { label: 'Who could you help?', help: 'A role or group, not a full name.', placeholder: 'e.g. our school club' },
      what: { label: 'What task could become easier?', help: 'One thing they do that takes effort.', placeholder: 'e.g. explain its events' },
      step: { label: 'What is your first step?' },
    },
    firstSteps: [
      'Ask them how they do the task today',
      'Ask what usually goes wrong',
      'Make a small draft after understanding the problem',
    ],
    examples: [
      'Help our school club explain its events.',
      'Help my family organize a shopping list.',
      'Help classmates practice a difficult topic.',
    ],
    reminder: 'Check your work and ask permission before using someone else’s information.',
    slide: 9,
  },
};

// The snack-demo page lives at /demo. Each feature-vote choice maps to one
// prepared branch; the presenter opens the winner from the control page.
const DEMO_BRANCHES = [
  { key: 'quantities', label: 'Choose snacks and quantities' },
  { key: 'total', label: 'See the total price' },
  { key: 'soldout', label: 'See which snacks are sold out' },
];

// Shown at the end of the talk: on students' phones (slide 10 and after the
// session ends), on the big screen, and as a line on the saved card.
const SOCIAL = {
  invite: 'Enjoyed this? Follow Jazmine for more.',
  links: [
    { key: 'instagram', label: 'Instagram', handle: '@jazminedeluna', url: 'https://www.instagram.com/jazminedeluna' },
    { key: 'facebook', label: 'Facebook', handle: 'Jazmine De Luna', url: 'https://www.facebook.com/search/top/?q=Jazmine%20De%20Luna%20Your%20AI%20Bestie' },
    { key: 'tiktok', label: 'TikTok', handle: '@jazmine.ai', url: 'https://www.tiktok.com/@jazmine.ai' },
  ],
};

// The "build your own" guide students read on their phones after the card.
const GUIDE = {
  title: 'Build and launch your own',
  intro: 'This app was built with AI help in a day. Here is how, so you can do the same.',
  sections: [
    {
      title: 'What this app is made of',
      items: [
        'A web page (HTML, CSS, JavaScript) that works on any phone — no app store needed.',
        'A small server (Node.js + Express) that counts the votes.',
        'A database (Redis on Upstash, free plan) so everyone sees the same results.',
        'Hosting on Vercel (free plan) and code on GitHub (free).',
      ],
    },
    {
      title: 'Which AI to use',
      items: [
        'ChatGPT or Claude — both can write a whole app like this. Pick the one you already have.',
        'Tell it who the app is for and the one thing it must do. Ask for the simplest version first.',
        'Ask for everything in one file (index.html) so it is easy to upload.',
        'When something breaks, paste the error message back. Ask it to explain what it changed.',
      ],
    },
    {
      title: 'Launch it in 5 steps',
      items: [
        'Ask ChatGPT or Claude: "Build a one-page web app, in a single index.html file, that ______."',
        'Open it on your phone and test it. Fix it with the AI until it does the one thing well.',
        'Make a free GitHub account, create a repository, upload index.html.',
        'Go to vercel.com, sign in with GitHub, import that repository, press Deploy.',
        'Share the link (or a QR code) with the people you built it for.',
      ],
    },
  ],
  prompt: 'Build a one-page web app in a single index.html file. It is for [who you want to help]. It must let them [the task] more easily. Keep it simple, make it work well on a phone, and explain how to test it.',
  rules: ['Ask clearly.', 'Check carefully.', 'Finish something useful.'],
};

module.exports = { SLIDES, ACTIVITIES, DEMO_BRANCHES, SOCIAL, GUIDE, SLIDE_COUNT: SLIDES.length };
