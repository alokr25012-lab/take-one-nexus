const INDIAN_CITIES = [
  "Mumbai", "Delhi", "Bengaluru", "Bangalore", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", 
  "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal", 
  "Visakhapatnam", "Pimpri-Chinchwad", "Patna", "Vadodara", "Ghaziabad", "Ludhiana", 
  "Agra", "Nashik", "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar", 
  "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai", "Allahabad", 
  "Ranchi", "Howrah", "Jabalpur", "Gwalior", "Vijayawada", "Jodhpur", "Madurai", "Raipur", 
  "Kota", "Guwahati", "Chandigarh", "Solapur", "Hubballi-Dharwad", "Bareilly", "Moradabad", 
  "Mysuru", "Gurgaon", "Gurugram", "Aligarh", "Jalandhar", "Tiruchirappalli", "Bhubaneswar", 
  "Salem", "Mira-Bhayandar", "Warangal", "Thiruvananthapuram", "Bhiwandi", "Saharanpur", 
  "Guntur", "Amravati", "Bikaner", "Noida", "Jamshedpur", "Bhilai", "Cuttack", "Firozabad", 
  "Kochi", "Nellore", "Bhavnagar", "Dehradun", "Durgapur", "Asansol", "Rourkela", "Nanded", 
  "Kolhapur", "Ajmer", "Akola", "Gulbarga", "Jamnagar", "Ujjain", "Loni", "Siliguri", 
  "Jhansi", "Ulhasnagar", "Jammu", "Sangli-Miraj & Kupwad", "Mangalore", "Erode", 
  "Belgaum", "Ambattur", "Tirunelveli", "Malegaon", "Gaya", "Jalgaon", "Udaipur", "Maheshtala",
  "Noida", "Greater Noida", "Ghaziabad", "Faridabad", "Sonipat", "Rohtak", "Panipat", "Karnal", "Hisar", "Ambala",
  "Coimbatore", "Mysuru", "Mangalore", "Vadodara", "Nashik", "Patna", "Ranchi", "Bhubaneswar", "Guwahati"
];

// Deduplicate
const UNIQUE_INDIAN_CITIES = [...new Set(INDIAN_CITIES)].sort((a, b) => a - b);

if (typeof window !== 'undefined') {
  window.INDIAN_CITIES = UNIQUE_INDIAN_CITIES;
}
