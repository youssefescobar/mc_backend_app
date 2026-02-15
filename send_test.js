const axios = require('axios');

const token = process.argv[2];

if (!token) {
    console.error('Usage: node send_test.js <FCM_TOKEN>');
    process.exit(1);
}

const payload = {
    tokens: [token], // We wrap the single token in an array
    title: "Urgent Alert",
    body: "saif el boly is earning more money than u",
    isUrgent: true
};

async function sendTest() {
    try {
        console.log('Sending urgent notification to:', token);
        const response = await axios.post('http://localhost:5000/api/push/send', payload);
        console.log('Success!', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

sendTest();
