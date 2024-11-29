const socket = io();

const container = document.getElementById('cards-container');

socket.on('machine-status', (data) => {
    let card = document.getElementById(data.ip);
    if (!card) {
        card = document.createElement('div');
        card.className = 'card';
        card.id = data.ip;
        container.appendChild(card);
    }

    card.innerHTML = `
        <h2>${data.name}</h2>
        <div class="status ${data.status.toLowerCase()}">${data.status}</div>
        <div class="response-time">Response time: ${data.responseTime} ms</div>
    `;
});
