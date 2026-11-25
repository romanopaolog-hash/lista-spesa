const memberProfileListeners = [];
let profileRevision = 0;
let savedProfile = {};
let draftPhoto = '';

function clearMemberProfiles() {
    memberProfileListeners.splice(0).forEach(stop => stop());
}

function showAvatar(container, photo, name) {
    container.replaceChildren();
    if (photo?.startsWith('data:image/jpeg;base64,')) {
        const image = document.createElement('img');
        image.alt = '';
        image.src = photo;
        container.append(image);
    } else {
        container.textContent = Array.from(name.trim() || '•')[0].toLocaleUpperCase('it');
    }
}

function bindMemberProfile(uid, originalName, label, avatar) {
    function display(profile) {
        label.textContent = profile?.nickname || originalName;
        showAvatar(avatar, profile?.photo, label.textContent);
    }
    display(null);
    memberProfileListeners.push(watch(db.ref('profiles').child(uid),
        snap => display(snap.val()), () => display(null)));
}

function updateProfilePreview() {
    showAvatar(el('profile-preview'), draftPhoto, el('profile-nickname').value || auth.currentUser?.displayName || '');
    el('profile-remove').hidden = !draftPhoto;
}

function resetProfileEditor() {
    profileRevision++;
    el('profile-dialog').close();
    savedProfile = {};
    draftPhoto = '';
    el('profile-form').reset();
    el('profile-preview').replaceChildren();
    el('profile-feedback').textContent = '';
}

function profileBusy(busy) {
    for (const id of ['profile-file', 'profile-nickname', 'profile-remove', 'profile-save']) el(id).disabled = busy;
}

async function openProfileEditor() {
    const user = auth.currentUser;
    if (!user) return;
    resetProfileEditor();
    const revision = profileRevision;
    profileBusy(true);
    el('profile-remove').hidden = true;
    el('profile-dialog').showModal();
    el('profile-feedback').textContent = 'Caricamento…';
    try {
        const snap = await db.ref('profiles').child(user.uid).once('value');
        if (revision !== profileRevision) return;
        savedProfile = snap.val() || {};
        draftPhoto = savedProfile.photo || '';
        el('profile-nickname').value = savedProfile.nickname || '';
        updateProfilePreview();
        el('profile-feedback').textContent = '';
        profileBusy(false);
    } catch {
        if (revision === profileRevision) el('profile-feedback').textContent = 'Caricamento non riuscito. Riapri il profilo per riprovare.';
    }
}

async function preparePhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('Scegli una foto JPEG, PNG o WebP.');
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 192;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 192, 192);
        context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
            size, size, 0, 0, 192, 192);
        return canvas.toDataURL('image/jpeg', 0.8);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function initProfileEditor() {
    document.querySelectorAll('.open-profile').forEach(button => { button.onclick = openProfileEditor; });
    el('profile-close').onclick = resetProfileEditor;
    el('profile-dialog').oncancel = event => { event.preventDefault(); resetProfileEditor(); };
    el('profile-nickname').oninput = updateProfilePreview;
    el('profile-remove').onclick = () => {
        draftPhoto = '';
        el('profile-file').value = '';
        updateProfilePreview();
    };
    el('profile-file').onchange = async event => {
        const file = event.target.files[0];
        if (!file) return;
        const revision = profileRevision;
        profileBusy(true);
        try {
            const photo = await preparePhoto(file);
            if (revision !== profileRevision) return;
            draftPhoto = photo;
            updateProfilePreview();
            el('profile-feedback').textContent = '';
        } catch {
            if (revision === profileRevision) el('profile-feedback').textContent = 'Foto non leggibile. Scegli un file JPEG, PNG o WebP.';
        } finally {
            if (revision === profileRevision) profileBusy(false);
        }
    };
    el('profile-form').onsubmit = async event => {
        event.preventDefault();
        const uid = auth.currentUser?.uid;
        if (!uid || el('profile-save').disabled) return;
        const revision = profileRevision;
        const nickname = el('profile-nickname').value.trim();
        const changes = {};
        if (nickname !== (savedProfile.nickname || '')) changes.nickname = nickname || null;
        if (draftPhoto !== (savedProfile.photo || '')) changes.photo = draftPhoto || null;
        profileBusy(true);
        try {
            if (Object.keys(changes).length) await db.ref('profiles').child(uid).update(changes);
            if (revision !== profileRevision) return;
            savedProfile = {nickname, photo: draftPhoto};
            el('profile-feedback').textContent = 'Profilo salvato.';
        } catch {
            if (revision === profileRevision) el('profile-feedback').textContent = 'Salvataggio non riuscito. Riprova.';
        } finally {
            if (revision === profileRevision) profileBusy(false);
        }
    };
}
