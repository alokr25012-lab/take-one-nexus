const INDIAN_COLLEGES = [
  "Rishihood University", "FTII Pune", "SRFTI Kolkata", "Whistling Woods International", 
  "National Institute of Design (NID)", "Srishti Institute of Art, Design and Technology",
  "Asian Academy of Film and Television (AAFT)", "L.V. Prasad Film and TV Academy",
  "AJK Mass Communication Research Centre", "Symbiosis Institute of Media and Communication",
  "Annapurna International School of Film and Media", "Zee Institute of Media Arts (ZIMA)",
  "Digital Academy - The Film School", "Mumbai University", "Delhi University",
  "Jawaharlal Nehru University", "Jamia Millia Islamia", "Jadavpur University",
  "Manipal Institute of Communication", "Xavier Institute of Communications",
  "Amity University", "Christ University", "Ashoka University", "O.P. Jindal Global University",
  "Krea University", "FLAME University", "Shiv Nadar University", "Azim Premji University",
  "Ahmedabad University", "Plaksha University"
];

const UNIQUE_INDIAN_COLLEGES = [...new Set(INDIAN_COLLEGES)].sort((a, b) => a - b);

if (typeof window !== 'undefined') {
  window.INDIAN_COLLEGES = UNIQUE_INDIAN_COLLEGES;
}
