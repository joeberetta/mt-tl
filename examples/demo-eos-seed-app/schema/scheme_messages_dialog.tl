---types---

updateDialogPinned#2acec004 flags:# pinned:flags.0?true pinned_by_peer:flags.1?true folder_id:flags.2?int peer:DialogPeer = Update;
// Этот тип не используется нами, нужен при наличии folder-ов (папки) и/или reorder (сортировка запиненных диалогов)
updatePinnedDialogs#fa0f3ca2 flags:# folder_id:flags.1?int order:flags.0?Vector<DialogPeer> = Update;

---types---

dialog#7516266c flags:# pinned:flags.0?true pinned_by_peer:flags.1?true unread_mark:flags.2?true peer:Peer top_message:int read_inbox_max_id:int read_outbox_max_id:int unread_count:int unread_mentions_count:int notify_settings:PeerNotifySettings pts:flags.3?int draft:flags.4?DraftMessage folder_id:flags.5?int unread_reactions_count:int = Dialog;

messages.peerDialogs#3371c354 dialogs:Vector<Dialog> messages:Vector<Message> chats:Vector<Chat> users:Vector<User> state:updates.State = messages.PeerDialogs;

dialogPeer#e56dbf05 peer:Peer = DialogPeer;
dialogPeerFolder#514519e2 folder_id:int = DialogPeer;

inputDialogPeer#fcaafeb7 peer:InputPeer = InputDialogPeer;
inputDialogPeerFolder#64600527 folder_id:int = InputDialogPeer;

---functions---

messages.getDialogs#ebea772c flags:# exclude_pinned:flags.0?Bool exclude_peer_pinned:flags.1?Bool folder_id:flags.2?int offset_date:int offset_id:int offset_peer:InputPeer limit:int hash:int = messages.Dialogs;
