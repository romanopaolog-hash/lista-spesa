const { onValueCreated } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

exports.notifyFamilyOwner = onValueCreated({
    ref: '/families/{code}/people/{uid}',
    instance: 'lista-della-spesa-1a23c-default-rtdb',
    region: 'europe-west1'
}, async event => {
    const person = event.data;
    if (person.child('status').val() !== 'pending') return;
    const family = person.ref.parent.parent;
    const [owner, current] = await Promise.all([family.child('owner').get(), person.ref.get()]);
    if (!owner.exists() || current.child('status').val() !== 'pending') return;
    const devices = family.root.child('devices').child(owner.val());
    const tokens = Object.entries((await devices.get()).val() || {});
    for (let start = 0; start < tokens.length; start += 500) {
        const batch = tokens.slice(start, start + 500);
        const result = await getMessaging().sendEachForMulticast({
            tokens: batch.map(([, token]) => token),
            data: { kind: 'family-request', owner: owner.val(), code: family.key },
            webpush: { headers: { TTL: '3600' } }
        });
        await Promise.all(result.responses.map(async (response, index) => {
            if (response.error?.code === 'messaging/registration-token-not-registered' ||
                response.error?.code === 'messaging/invalid-registration-token') {
                const [deviceId, token] = batch[index];
                await devices.child(deviceId).transaction(value => value === token ? null : undefined);
            } else if (response.error) {
                console.error('Invio push non riuscito', response.error.code);
            }
        }));
    }
});
