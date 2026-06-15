---types---

boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;

true#3fedd339 = True;

error#c4b9f9bb code:int text:string = Error;

null#56730bcc = Null;

inputPeerEmpty#7f3b18ea = InputPeer;
inputPeerSelf#7da07ec9 = InputPeer;
inputPeerChat#179be863 chat_id:int = InputPeer;
inputPeerUser#7b8e7de6 user_id:int access_hash:long = InputPeer;
inputPeerChannel#20adaef8 channel_id:int access_hash:long = InputPeer;

inputPhoneContact#f392b7f4 client_id:long phone:string first_name:string last_name:string = InputContact;

inputFile#f52ff27f id:long parts:int name:string md5_checksum:string = InputFile;
inputFileBig#fa4f0bb5 id:long parts:int name:string = InputFile;

inputMediaEmpty#9664f57f = InputMedia;
inputMediaUploadedPhoto#1e287d04 flags:# file:InputFile stickers:flags.0?Vector<InputDocument> ttl_seconds:flags.1?int = InputMedia;
inputMediaPhoto#b3ba0635 flags:# id:InputPhoto ttl_seconds:flags.0?int = InputMedia;
inputMediaGeoPoint#f9c44144 geo_point:InputGeoPoint = InputMedia;
inputMediaContact#f8ab7dfb phone_number:string first_name:string last_name:string vcard:string = InputMedia;
inputMediaUploadedDocument#5b38c6c1 flags:# nosound_video:flags.3?true file:InputFile thumb:flags.2?InputFile mime_type:string attributes:Vector<DocumentAttribute> stickers:flags.0?Vector<InputDocument> ttl_seconds:flags.1?int = InputMedia;
inputMediaDocument#23ab23d2 flags:# id:InputDocument ttl_seconds:flags.0?int = InputMedia;
inputMediaGeoLive#ce4e82fd flags:# stopped:flags.0?true geo_point:InputGeoPoint period:flags.1?int = InputMedia;
inputMediaPoll#06b3765b poll:Poll = InputMedia;

inputChatPhotoEmpty#1ca48f57 = InputChatPhoto;
inputChatUploadedPhoto#927c55b4 file:InputFile = InputChatPhoto;
inputChatPhoto#8953ad37 id:InputPhoto = InputChatPhoto;

peerUser#9db1bc6d user_id:int = Peer;
peerChat#bad0e5bb chat_id:int = Peer;
peerChannel#bddde532 channel_id:int = Peer;
peerSupport#a1888949 = Peer;
peerExchange#a8229c0c = Peer;

userStatusEmpty#09d05049 = UserStatus;
userStatusOnline#edb93949 expires:int = UserStatus;
userStatusOffline#008c703f was_online:int = UserStatus;
userStatusRecently#e26f42f1 = UserStatus;
userStatusLastWeek#07bf09fc = UserStatus;
userStatusLastMonth#77ebc742 = UserStatus;

chatEmpty#9ba2d800 id:int = Chat;
chat#3bda1bde flags:# creator:flags.0?true kicked:flags.1?true left:flags.2?true deactivated:flags.5?true id:int title:string photo:ChatPhoto participants_count:int date:int version:int migrated_to:flags.6?InputChannel admin_rights:flags.14?ChatAdminRights default_banned_rights:flags.18?ChatBannedRights = Chat;
chatForbidden#07328bdb id:int title:string = Chat;
channel#4df30834 flags:# creator:flags.0?true left:flags.2?true broadcast:flags.5?true verified:flags.7?true megagroup:flags.8?true restricted:flags.9?true signatures:flags.11?true min:flags.12?true scam:flags.19?true id:int access_hash:flags.13?long title:string username:flags.6?string photo:ChatPhoto date:int version:int restriction_reason:flags.9?string admin_rights:flags.14?ChatAdminRights banned_rights:flags.15?ChatBannedRights default_banned_rights:flags.18?ChatBannedRights participants_count:flags.17?int = Chat;
channelForbidden#289da732 flags:# broadcast:flags.5?true megagroup:flags.8?true id:int access_hash:long title:string until_date:flags.16?int = Chat;

chatFull#1b7c9db3 flags:# can_set_username:flags.7?true id:int about:string participants:ChatParticipants chat_photo:flags.2?Photo notify_settings:PeerNotifySettings exported_invite:ExportedChatInvite bot_info:flags.3?Vector<BotInfo> pinned_msg_id:flags.6?int folder_id:flags.11?int = ChatFull;
channelFull#03648977 flags:# can_view_participants:flags.3?true can_set_username:flags.6?true can_set_stickers:flags.7?true hidden_prehistory:flags.10?true can_view_stats:flags.12?true id:int about:string participants_count:flags.0?int admins_count:flags.1?int kicked_count:flags.2?int banned_count:flags.2?int online_count:flags.13?int read_inbox_max_id:int read_outbox_max_id:int unread_count:int chat_photo:Photo notify_settings:PeerNotifySettings exported_invite:ExportedChatInvite bot_info:Vector<BotInfo> migrated_from_chat_id:flags.4?int migrated_from_max_id:flags.4?int pinned_msg_id:flags.5?int stickerset:flags.8?StickerSet available_min_id:flags.9?int folder_id:flags.11?int pts:int = ChatFull;

chatParticipant#c8d7493e user_id:int inviter_id:int date:int = ChatParticipant;
chatParticipantCreator#da13538a user_id:int = ChatParticipant;
chatParticipantAdmin#e2d6e436 user_id:int inviter_id:int date:int = ChatParticipant;

chatParticipantsForbidden#fc900c2b flags:# chat_id:int self_participant:flags.0?ChatParticipant = ChatParticipants;
chatParticipants#3f460fed chat_id:int participants:Vector<ChatParticipant> version:int = ChatParticipants;

chatPhotoEmpty#faac992d flags:# color_id:flags.0?string = ChatPhoto;
chatPhoto#53a3366d photo_small:FileLocation photo_big:FileLocation dc_id:int url:string = ChatPhoto;

messageEmpty#83e5de54 id:int = Message;
messageService#9e19a1f6 flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true silent:flags.13?true post:flags.14?true id:int from_id:flags.8?int to_id:Peer reply_to_msg_id:flags.3?int date:int action:MessageAction = Message;
message#204f68eb flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true silent:flags.13?true post:flags.14?true from_scheduled:flags.18?true legacy:flags.19?true id:int from_id:flags.8?int to_id:Peer fwd_from:flags.2?MessageFwdHeader via_bot_id:flags.11?int reply_to_msg_id:flags.3?int date:int message:string media:flags.9?MessageMedia reply_markup:flags.6?ReplyMarkup entities:flags.7?Vector<MessageEntity> views:flags.10?int edit_date:flags.15?int post_author:flags.16?string grouped_id:flags.17?long reminder_ids:Vector<int> linked_posts:flags.20?true linked_stories:flags.21?true reactions:flags.22?MessageReactions = Message;

messageMediaEmpty#3ded6320 = MessageMedia;
messageMediaPhoto#695150d7 flags:# photo:flags.0?Photo ttl_seconds:flags.2?int = MessageMedia;
messageMediaGeo#56e0d474 geo:GeoPoint = MessageMedia;
messageMediaContact#cbf24940 phone_number:string first_name:string last_name:string vcard:string user_id:int = MessageMedia;
messageMediaUnsupported#9f84f49e = MessageMedia;
messageMediaDocument#9cb070d7 flags:# document:flags.0?Document ttl_seconds:flags.2?int = MessageMedia;
messageMediaWebPage#a32dd600 webpage:WebPage = MessageMedia;
messageMediaVenue#2ec0533f geo:GeoPoint title:string address:string provider:string venue_id:string venue_type:string = MessageMedia;
messageMediaGame#fdb19008 game:Game = MessageMedia;
messageMediaPoll#4bd6e798 poll:Poll results:PollResults = MessageMedia;
messageMediaVoipCall#fda07d42 flags:# call_id:string reason:voip.CallEndReason duration:flags.0?int = MessageMedia;
messageMediaVoipCallDeepLink#722aef23 invite_url:string invite_url_payload:DeepLinkPayload = MessageMedia;
messageActionEmpty#b6aef7b0 = MessageAction;
messageActionChatCreate#a6638b9a title:string users:Vector<int> = MessageAction;
messageActionChatEditTitle#b5a1ce5a title:string = MessageAction;
messageActionChatEditPhoto#7fcb13a8 photo:Photo = MessageAction;
messageActionChatDeletePhoto#95e3fbef = MessageAction;
messageActionChatAddUser#488a7337 users:Vector<int> = MessageAction;
messageActionChatDeleteUser#b2ae9b0c user_id:int = MessageAction;
messageActionChatJoinedByLink#f89cf5e8 inviter_id:int = MessageAction;
messageActionChannelCreate#95d2ac92 title:string = MessageAction;
messageActionChatMigrateTo#51bdb021 channel_id:int = MessageAction;
messageActionChannelMigrateFrom#b055eaee title:string chat_id:int = MessageAction;
messageActionPinMessage#94bd38ed = MessageAction;
messageActionHistoryClear#9fbab604 = MessageAction;
messageActionGameScore#92a72876 game_id:long score:int = MessageAction;
messageActionPaymentSent#40699cd0 currency:string total_amount:long = MessageAction;
messageActionPhoneCall#80e11a7f flags:# video:flags.2?true call_id:long reason:flags.0?PhoneCallDiscardReason duration:flags.1?int = MessageAction;
messageActionScreenshotTaken#4792929b = MessageAction;
messageActionCustomAction#fae69f56 message:string = MessageAction;
messageActionBotAllowed#abe9affe domain:string = MessageAction;
messageActionContactSignUp#f3f25f76 = MessageAction;

dialogFolder#71bd134c flags:# pinned:flags.2?true folder:Folder peer:Peer top_message:int unread_muted_peers_count:int unread_unmuted_peers_count:int unread_muted_messages_count:int unread_unmuted_messages_count:int = Dialog;

geoPointEmpty#1117dd5f = GeoPoint;

inputNotifyPeer#b8bc5b0c peer:InputPeer = InputNotifyPeer;
inputNotifyUsers#193b4417 = InputNotifyPeer;
inputNotifyChats#4a95e84e = InputNotifyPeer;
inputNotifyBroadcasts#b1db7c7e = InputNotifyPeer;
inputPeerSupport#e4e4ce16 = InputPeer;
inputPeerExchange#5f22db8f = InputPeer;

inputPeerNotifySettings#9c3d198e flags:# show_previews:flags.0?Bool silent:flags.1?Bool mute_until:flags.2?int sound:flags.3?string = InputPeerNotifySettings;

peerNotifySettings#af509d20 flags:# show_previews:flags.0?Bool silent:flags.1?Bool mute_until:flags.2?int sound:flags.3?string = PeerNotifySettings;

peerSettings#818426cd flags:# report_spam:flags.0?true = PeerSettings;



messages.dialogs#15ba6c40 dialogs:Vector<Dialog> messages:Vector<Message> chats:Vector<Chat> users:Vector<User> = messages.Dialogs;
messages.dialogsSlice#71e094f3 count:int dialogs:Vector<Dialog> messages:Vector<Message> chats:Vector<Chat> users:Vector<User> = messages.Dialogs;
messages.dialogsNotModified#f0e3e596 count:int = messages.Dialogs;

messages.messages#8c718e87 messages:Vector<Message> chats:Vector<Chat> users:Vector<User> = messages.Messages;
messages.messagesSlice#a6c47aaa flags:# inexact:flags.1?true count:int messages:Vector<Message> chats:Vector<Chat> users:Vector<User> = messages.Messages;
messages.channelMessages#99262e37 flags:# inexact:flags.1?true pts:int count:int messages:Vector<Message> chats:Vector<Chat> users:Vector<User> = messages.Messages;
messages.messagesNotModified#74535f21 count:int = messages.Messages;

messages.chats#64ff9fd5 chats:Vector<Chat> = messages.Chats;
messages.chatsSlice#9cd81144 count:int chats:Vector<Chat> = messages.Chats;

messages.chatFull#e5d7d19c full_chat:ChatFull chats:Vector<Chat> users:Vector<User> = messages.ChatFull;

messages.affectedHistory#b45c69d1 pts:int pts_count:int offset:int = messages.AffectedHistory;

inputMessagesFilterEmpty#57e2f66c = MessagesFilter;
inputMessagesFilterPhotos#9609a51c = MessagesFilter;
inputMessagesFilterVideo#9fc00e65 = MessagesFilter;
inputMessagesFilterPhotoVideo#56e9f0e4 = MessagesFilter;
inputMessagesFilterDocument#9eddf188 = MessagesFilter;
inputMessagesFilterUrl#7ef0dd87 = MessagesFilter;
inputMessagesFilterGif#ffc86587 = MessagesFilter;
inputMessagesFilterVoice#50f5c392 = MessagesFilter;
inputMessagesFilterMusic#3751b49e = MessagesFilter;
inputMessagesFilterChatPhotos#3a20ecb8 = MessagesFilter;
inputMessagesFilterPhoneCalls#80c99768 flags:# missed:flags.0?true = MessagesFilter;
inputMessagesFilterRoundVoice#7a7c17a4 = MessagesFilter;
inputMessagesFilterRoundVideo#b549da53 = MessagesFilter;
inputMessagesFilterMyMentions#c1f8e69a = MessagesFilter;
inputMessagesFilterGeo#e7026d0d = MessagesFilter;
inputMessagesFilterContacts#e062db83 = MessagesFilter;

updateNewMessage#1f2b0afd message:Message pts:int pts_count:int = Update;
updateMessageID#4e90bfd6 id:int random_id:long = Update;
updateDeleteMessages#5e917f79 messages:Vector<int> peer:Peer pts:int pts_count:int = Update;
updateUserTyping#5c486927 user_id:int action:SendMessageAction = Update;
updateChatUserTyping#9a65ea1f chat_id:int user_id:int action:SendMessageAction = Update;
updateChatParticipants#07761198 participants:ChatParticipants = Update;
updateNewEncryptedMessage#12bcbd9a message:EncryptedMessage qts:int = Update;
updateEncryptedChatTyping#1710f156 chat_id:int = Update;
updateEncryption#b4a2e88d chat:EncryptedChat date:int = Update;
updateEncryptedMessagesRead#38fe25b7 chat_id:int max_date:int date:int = Update;
updateChatParticipantAdd#ea4b0e5c chat_id:int user_id:int inviter_id:int date:int version:int = Update;
updateChatParticipantDelete#6e5f8c22 chat_id:int user_id:int version:int = Update;
updateDcOptions#8e5e9873 dc_options:Vector<DcOption> = Update;
updateNotifySettings#bec268ef peer:NotifyPeer notify_settings:PeerNotifySettings = Update;
updateServiceNotification#ebe46819 flags:# popup:flags.0?true inbox_date:flags.1?int type:string message:string media:MessageMedia entities:Vector<MessageEntity> = Update;
updateReadHistoryInbox#9c974fdf flags:# folder_id:flags.0?int peer:Peer max_id:int still_unread_count:int pts:int pts_count:int = Update;
updateReadHistoryOutbox#2f2f21bf peer:Peer max_id:int pts:int pts_count:int = Update;
updateWebPage#7f891213 webpage:WebPage pts:int pts_count:int = Update;
updateReadMessagesContents#68c13933 messages:Vector<int> pts:int pts_count:int = Update;
updateChannelTooLong#eb0467fb flags:# channel_id:int pts:flags.0?int = Update;
updateChannel#b6d45656 channel_id:int = Update;
updateNewChannelMessage#62ba04d9 message:Message pts:int pts_count:int = Update;
updateReadChannelInbox#330b5424 flags:# folder_id:flags.0?int channel_id:int max_id:int still_unread_count:int pts:int = Update;
updateDeleteChannelMessages#c37521c9 channel_id:int messages:Vector<int> pts:int pts_count:int = Update;
updateChannelMessageViews#98a12b4b channel_id:int id:int views:int = Update;
updateChatParticipantAdmin#b6901959 chat_id:int user_id:int is_admin:Bool version:int = Update;
updateNewStickerSet#688a30aa stickerset:messages.StickerSet = Update;
updateStickerSetsOrder#0bb2d201 flags:# masks:flags.0?true order:Vector<long> = Update;
updateStickerSets#43ae3dec = Update;
updateSavedGifs#9375341e = Update;
updateBotInlineQuery#54826690 flags:# query_id:long user_id:int query:string geo:flags.0?GeoPoint offset:string = Update;
updateBotInlineSend#0e48f964 flags:# user_id:int query:string geo:flags.0?GeoPoint id:string msg_id:flags.1?InputBotInlineMessageID = Update;
updateEditChannelMessage#1b3f4df7 message:Message pts:int pts_count:int = Update;
updateChannelPinnedMessage#98592475 channel_id:int id:int = Update;
updateBotCallbackQuery#e73547e1 flags:# query_id:long user_id:int peer:Peer msg_id:int chat_instance:long data:flags.0?bytes game_short_name:flags.1?string = Update;
updateEditMessage#e40370a3 message:Message pts:int pts_count:int = Update;
updateInlineBotCallbackQuery#f9d27a5a flags:# query_id:long user_id:int msg_id:InputBotInlineMessageID chat_instance:long data:flags.0?bytes game_short_name:flags.1?string = Update;
updateReadChannelOutbox#25d6c9c7 channel_id:int max_id:int = Update;
updateDraftMessage#ee2bb969 peer:Peer draft:DraftMessage = Update;
updateReadFeaturedStickers#571d2742 = Update;
updateRecentStickers#9a422c20 = Update;
updateConfig#a229dd06 = Update;
updateChannelWebPage#40771900 channel_id:int webpage:WebPage pts:int pts_count:int = Update;
updateBotWebhookJSON#8317c0c3 data:DataJSON = Update;
updateBotWebhookJSONQuery#9b9240a6 query_id:long data:DataJSON timeout:int = Update;
updatePhoneCall#ab0f6b1e phone_call:PhoneCall = Update;
updateFavedStickers#e511996d = Update;
updateChannelReadMessagesContents#89893b45 channel_id:int messages:Vector<int> = Update;
updateChannelAvailableMessages#70db6837 channel_id:int available_min_id:int = Update;
updateDialogUnreadMark#e16459c3 flags:# unread:flags.0?true peer:DialogPeer = Update;
updateUserPinnedMessage#4c43da18 user_id:int id:int = Update;
updateChatPinnedMessage#e10db349 chat_id:int id:int version:int = Update;
updateMessagePoll#aca1657b flags:# poll_id:long poll:flags.0?Poll results:PollResults = Update;
updateChatDefaultBannedRights#54c01850 peer:Peer default_banned_rights:ChatBannedRights version:int = Update;
updateFolderPeers#19360dc0 folder_peers:Vector<FolderPeer> pts:int pts_count:int = Update;

updateShortMessage#914fbf11 flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true silent:flags.13?true id:int user_id:int message:string pts:int pts_count:int date:int fwd_from:flags.2?MessageFwdHeader via_bot_id:flags.11?int reply_to_msg_id:flags.3?int entities:flags.7?Vector<MessageEntity> = Updates;
updateShortChatMessage#16812688 flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true silent:flags.13?true id:int from_id:int chat_id:int message:string pts:int pts_count:int date:int fwd_from:flags.2?MessageFwdHeader via_bot_id:flags.11?int reply_to_msg_id:flags.3?int entities:flags.7?Vector<MessageEntity> = Updates;
updateShortSentMessage#11f1331c flags:# out:flags.1?true id:int pts:int pts_count:int date:int media:flags.9?MessageMedia entities:flags.7?Vector<MessageEntity> = Updates;

dcOption#18b7a10d flags:# ipv6:flags.0?true media_only:flags.1?true tcpo_only:flags.2?true cdn:flags.3?true static:flags.4?true id:int ip_address:string port:int secret:flags.10?bytes = DcOption;

config#5c5168f0 flags:# phonecalls_enabled:flags.1?true default_p2p_contacts:flags.3?true preload_featured_stickers:flags.4?true ignore_phone_entities:flags.5?true revoke_pm_inbox:flags.6?true blocked_mode:flags.8?true pfs_enabled:flags.13?true date:int expires:int test_mode:Bool this_dc:int dc_options:Vector<DcOption> dc_txt_domain_name:string chat_size_max:int megagroup_size_max:int forwarded_count_max:int online_update_period_ms:int offline_blur_timeout_ms:int offline_idle_timeout_ms:int online_cloud_timeout_ms:int notify_cloud_delay_ms:int notify_default_delay_ms:int push_chat_period_ms:int push_chat_limit:int saved_gifs_limit:int edit_time_limit:int revoke_time_limit:int revoke_pm_time_limit:int rating_e_decay:int stickers_recent_limit:int stickers_faved_limit:int channels_read_media_period:int tmp_sessions:flags.0?int pinned_dialogs_count_max:int pinned_infolder_count_max:int call_receive_timeout_ms:int call_ring_timeout_ms:int call_connect_timeout_ms:int call_packet_timeout_ms:int me_url_prefix:string autoupdate_url_prefix:flags.7?string gif_search_username:flags.9?string venue_search_username:flags.10?string img_search_username:flags.11?string static_maps_provider:flags.12?string caption_length_max:int message_length_max:int webfile_dc_id:int suggested_lang_code:flags.2?string lang_pack_version:flags.2?int base_lang_pack_version:flags.2?int disabled_features:Vector<DisabledFeature> = Config;
disabledFeature#ae636f24 feature:string description:string = DisabledFeature;

nearestDc#8e1a1775 country:string this_dc:int nearest_dc:int = NearestDc;

help.appUpdate#1da7158f flags:# popup:flags.0?true id:int version:string text:string entities:Vector<MessageEntity> document:flags.1?Document url:flags.2?string = help.AppUpdate;
help.noAppUpdate#c45a6536 = help.AppUpdate;

help.inviteText#18cb9f78 message:string = help.InviteText;

encryptedChatEmpty#ab7ec0a0 id:int = EncryptedChat;
encryptedChatWaiting#3bf703dc id:int access_hash:long date:int admin_id:int participant_id:int = EncryptedChat;
encryptedChatRequested#c878527e id:int access_hash:long date:int admin_id:int participant_id:int g_a:bytes = EncryptedChat;
encryptedChat#fa56ce36 id:int access_hash:long date:int admin_id:int participant_id:int g_a_or_b:bytes key_fingerprint:long = EncryptedChat;
encryptedChatDiscarded#13d6dd27 id:int = EncryptedChat;

inputEncryptedChat#f141b5e1 chat_id:int access_hash:long = InputEncryptedChat;

encryptedFileEmpty#c21f497e = EncryptedFile;
encryptedFile#4a70994c id:long access_hash:long size:int dc_id:int key_fingerprint:int = EncryptedFile;

inputEncryptedFileEmpty#1837c364 = InputEncryptedFile;
inputEncryptedFileUploaded#64bd0306 id:long parts:int md5_checksum:string key_fingerprint:int = InputEncryptedFile;
inputEncryptedFile#5a17b5e5 id:long access_hash:long = InputEncryptedFile;
inputEncryptedFileBigUploaded#2dc173c8 id:long parts:int key_fingerprint:int = InputEncryptedFile;

encryptedMessage#ed18c118 random_id:long chat_id:int date:int bytes:bytes file:EncryptedFile = EncryptedMessage;
encryptedMessageService#23734b06 random_id:long chat_id:int date:int bytes:bytes = EncryptedMessage;

messages.dhConfigNotModified#c0e24635 random:bytes = messages.DhConfig;
messages.dhConfig#2c221edd g:int p:bytes version:int random:bytes = messages.DhConfig;

messages.sentEncryptedMessage#560f8935 date:int = messages.SentEncryptedMessage;
messages.sentEncryptedFile#9493ff32 date:int file:EncryptedFile = messages.SentEncryptedMessage;

help.support#17c6b5f6 phone_number:string user:User = help.Support;

notifyPeer#9fd40bd8 peer:Peer = NotifyPeer;
notifyUsers#b4c83b4c = NotifyPeer;
notifyChats#c007cec3 = NotifyPeer;
notifyBroadcasts#d612e8ef = NotifyPeer;

sendMessageTypingAction#16bf744e = SendMessageAction;
sendMessageCancelAction#fd5ec8f5 = SendMessageAction;
sendMessageRecordVideoAction#a187d66f = SendMessageAction;
sendMessageUploadVideoAction#e9763aec progress:int = SendMessageAction;
sendMessageRecordAudioAction#d52f73f7 = SendMessageAction;
sendMessageUploadAudioAction#f351d7ab progress:int = SendMessageAction;
sendMessageUploadPhotoAction#d1d34a26 progress:int = SendMessageAction;
sendMessageUploadDocumentAction#aa0cd9e4 progress:int = SendMessageAction;
sendMessageGeoLocationAction#176f8ba1 = SendMessageAction;
sendMessageChooseContactAction#628cbc6f = SendMessageAction;
sendMessageGamePlayAction#dd6a8f48 = SendMessageAction;
sendMessageRecordRoundAction#88f27fbc = SendMessageAction;
sendMessageUploadRoundAction#243e1c66 progress:int = SendMessageAction;

messages.stickersNotModified#f1749a22 = messages.Stickers;
messages.stickers#e4599bbd hash:int stickers:Vector<Document> = messages.Stickers;

stickerPack#12b299d4 emoticon:string documents:Vector<long> = StickerPack;

messages.allStickersNotModified#e86602c3 = messages.AllStickers;
messages.allStickers#edfd405f hash:int sets:Vector<StickerSet> = messages.AllStickers;

messages.affectedMessages#84d19185 pts:int pts_count:int = messages.AffectedMessages;

contactLinkUnknown#5f4f9247 = ContactLink;
contactLinkNone#feedd3ad = ContactLink;
contactLinkHasPhone#268f3f59 = ContactLink;
contactLinkContact#d502c2d0 = ContactLink;

webPageEmpty#eb1477e8 id:long = WebPage;
webPagePending#c586da1c id:long date:int = WebPage;
webPage#5f07b4bc flags:# id:long url:string display_url:string hash:int type:flags.0?string site_name:flags.1?string title:flags.2?string description:flags.3?string photo:flags.4?Photo embed_url:flags.5?string embed_type:flags.5?string embed_width:flags.6?int embed_height:flags.6?int duration:flags.7?int author:flags.8?string document:flags.9?Document cached_page:flags.10?Page = WebPage;
webPageNotModified#85849473 = WebPage;

receivedNotifyMessage#a384b779 id:int flags:int = ReceivedNotifyMessage;

chatInviteEmpty#69df3769 = ExportedChatInvite;
chatInviteExported#fc2e05bc link:string = ExportedChatInvite;

chatInviteAlready#5a686d7c chat:Chat = ChatInvite;
chatInvite#dfc2f58e flags:# channel:flags.0?true broadcast:flags.1?true public:flags.2?true megagroup:flags.3?true title:string photo:Photo participants_count:int participants:flags.4?Vector<User> = ChatInvite;


stickerSet#eeb46f27 flags:# archived:flags.1?true official:flags.2?true masks:flags.3?true installed_date:flags.0?int id:long access_hash:long title:string short_name:string thumb:flags.4?PhotoSize thumb_dc_id:flags.4?int count:int hash:int = StickerSet;

messages.stickerSet#b60a24a6 set:StickerSet packs:Vector<StickerPack> documents:Vector<Document> = messages.StickerSet;

botCommand#c27ac8c7 command:string description:string = BotCommand;

botInfo#98e81d3a user_id:int description:string commands:Vector<BotCommand> = BotInfo;

keyboardButton#a2fa4880 text:string = KeyboardButton;
keyboardButtonUrl#258aff05 text:string url:string = KeyboardButton;
keyboardButtonCallback#683a5e46 text:string data:bytes = KeyboardButton;
keyboardButtonRequestPhone#b16a6c29 text:string = KeyboardButton;
keyboardButtonRequestGeoLocation#fc796b3f text:string = KeyboardButton;
keyboardButtonSwitchInline#0568a748 flags:# same_peer:flags.0?true text:string query:string = KeyboardButton;
keyboardButtonGame#50f41ccf text:string = KeyboardButton;
keyboardButtonBuy#afd93fbb text:string = KeyboardButton;

keyboardButtonRow#77608b83 buttons:Vector<KeyboardButton> = KeyboardButtonRow;

replyKeyboardHide#a03e5b85 flags:# selective:flags.2?true = ReplyMarkup;
replyKeyboardForceReply#f4108aa0 flags:# single_use:flags.1?true selective:flags.2?true = ReplyMarkup;
replyKeyboardMarkup#3502758c flags:# resize:flags.0?true single_use:flags.1?true selective:flags.2?true rows:Vector<KeyboardButtonRow> = ReplyMarkup;
replyInlineMarkup#48a30254 rows:Vector<KeyboardButtonRow> = ReplyMarkup;

messageEntityUnknown#bb92ba95 offset:int length:int = MessageEntity;
messageEntityMention#fa04579d offset:int length:int = MessageEntity;
messageEntityHashtag#6f635b0d offset:int length:int = MessageEntity;
messageEntityBotCommand#6cef8ac7 offset:int length:int = MessageEntity;
messageEntityUrl#6ed02538 offset:int length:int = MessageEntity;
messageEntityEmail#64e475c2 offset:int length:int = MessageEntity;
messageEntityBold#bd610bc9 offset:int length:int = MessageEntity;
messageEntityItalic#826f8b60 offset:int length:int = MessageEntity;
messageEntityCode#28a20571 offset:int length:int = MessageEntity;
messageEntityPre#73924be0 offset:int length:int language:string = MessageEntity;
messageEntityTextUrl#76a6d327 offset:int length:int url:string = MessageEntity;
messageEntityMentionName#352dca58 offset:int length:int user_id:int = MessageEntity;
inputMessageEntityMentionName#208e68c9 offset:int length:int user_id:InputUser = MessageEntity;
messageEntityPhone#9b69e34b offset:int length:int = MessageEntity;
messageEntityCashtag#4c4e743f offset:int length:int = MessageEntity;
messageEntityUnderline#0953b4ac offset:int length:int = MessageEntity;

inputChannelEmpty#ee8c1e86 = InputChannel;
inputChannel#afeb712e channel_id:int access_hash:long = InputChannel;


messageRange#0ae30253 min_id:int max_id:int = MessageRange;

channelMessagesFilterEmpty#94d42ee7 = ChannelMessagesFilter;
channelMessagesFilter#cd77d957 flags:# exclude_new_messages:flags.1?true ranges:Vector<MessageRange> = ChannelMessagesFilter;

channelParticipant#15ebac1d user_id:int date:int = ChannelParticipant;
channelParticipantSelf#a3289a6d user_id:int inviter_id:int date:int = ChannelParticipant;
channelParticipantCreator#e3e2e1f9 user_id:int = ChannelParticipant;
channelParticipantAdmin#5daa6e23 flags:# can_edit:flags.0?true self:flags.1?true user_id:int inviter_id:flags.1?int promoted_by:int date:int admin_rights:ChatAdminRights = ChannelParticipant;
channelParticipantBanned#1c0facaf flags:# left:flags.0?true user_id:int kicked_by:int date:int banned_rights:ChatBannedRights = ChannelParticipant;

channelParticipantsRecent#de3f3c79 = ChannelParticipantsFilter;
channelParticipantsAdmins#b4608969 = ChannelParticipantsFilter;
channelParticipantsKicked#a3b54985 q:string = ChannelParticipantsFilter;
channelParticipantsBots#b0d1865b = ChannelParticipantsFilter;
channelParticipantsBanned#1427a5e1 q:string = ChannelParticipantsFilter;
channelParticipantsSearch#0656ac4b q:string = ChannelParticipantsFilter;
channelParticipantsContacts#bb6ae88d q:string = ChannelParticipantsFilter;

channels.channelParticipants#f56ee2a8 count:int participants:Vector<ChannelParticipant> users:Vector<User> = channels.ChannelParticipants;
channels.channelParticipantsNotModified#f0173fe9 = channels.ChannelParticipants;

channels.channelParticipant#d0d9b163 participant:ChannelParticipant users:Vector<User> = channels.ChannelParticipant;

help.termsOfService#780a0310 flags:# popup:flags.0?true id:DataJSON text:string entities:Vector<MessageEntity> min_age_confirm:flags.1?int = help.TermsOfService;

foundGif#162ecc1f url:string thumb_url:string content_url:string content_type:string w:int h:int = FoundGif;
foundGifCached#9c750409 url:string photo:Photo document:Document = FoundGif;

messages.foundGifs#450a1c0a next_offset:int results:Vector<FoundGif> = messages.FoundGifs;

messages.savedGifsNotModified#e8025ca2 = messages.SavedGifs;
messages.savedGifs#2e0709a5 hash:int gifs:Vector<Document> = messages.SavedGifs;

inputBotInlineMessageMediaAuto#3380c786 flags:# message:string entities:flags.1?Vector<MessageEntity> reply_markup:flags.2?ReplyMarkup = InputBotInlineMessage;
inputBotInlineMessageText#3dcd7a87 flags:# no_webpage:flags.0?true message:string entities:flags.1?Vector<MessageEntity> reply_markup:flags.2?ReplyMarkup = InputBotInlineMessage;
inputBotInlineMessageMediaGeo#c1b15d65 flags:# geo_point:InputGeoPoint period:int reply_markup:flags.2?ReplyMarkup = InputBotInlineMessage;
inputBotInlineMessageMediaVenue#417bbf11 flags:# geo_point:InputGeoPoint title:string address:string provider:string venue_id:string venue_type:string reply_markup:flags.2?ReplyMarkup = InputBotInlineMessage;
inputBotInlineMessageMediaContact#a6edbffd flags:# phone_number:string first_name:string last_name:string vcard:string reply_markup:flags.2?ReplyMarkup = InputBotInlineMessage;
inputBotInlineMessageGame#4b425864 flags:# reply_markup:flags.2?ReplyMarkup = InputBotInlineMessage;

inputBotInlineResult#88bf9319 flags:# id:string type:string title:flags.1?string description:flags.2?string url:flags.3?string thumb:flags.4?InputWebDocument content:flags.5?InputWebDocument send_message:InputBotInlineMessage = InputBotInlineResult;
inputBotInlineResultPhoto#a8d864a7 id:string type:string photo:InputPhoto send_message:InputBotInlineMessage = InputBotInlineResult;
inputBotInlineResultDocument#fff8fdc4 flags:# id:string type:string title:flags.1?string description:flags.2?string document:InputDocument send_message:InputBotInlineMessage = InputBotInlineResult;
inputBotInlineResultGame#4fa417f2 id:string short_name:string send_message:InputBotInlineMessage = InputBotInlineResult;

botInlineMessageMediaAuto#764cf810 flags:# message:string entities:flags.1?Vector<MessageEntity> reply_markup:flags.2?ReplyMarkup = BotInlineMessage;
botInlineMessageText#8c7f65e2 flags:# no_webpage:flags.0?true message:string entities:flags.1?Vector<MessageEntity> reply_markup:flags.2?ReplyMarkup = BotInlineMessage;
botInlineMessageMediaGeo#b722de65 flags:# geo:GeoPoint period:int reply_markup:flags.2?ReplyMarkup = BotInlineMessage;
botInlineMessageMediaVenue#8a86659c flags:# geo:GeoPoint title:string address:string provider:string venue_id:string venue_type:string reply_markup:flags.2?ReplyMarkup = BotInlineMessage;
botInlineMessageMediaContact#18d1cdc2 flags:# phone_number:string first_name:string last_name:string vcard:string reply_markup:flags.2?ReplyMarkup = BotInlineMessage;

botInlineResult#11965f3a flags:# id:string type:string title:flags.1?string description:flags.2?string url:flags.3?string thumb:flags.4?WebDocument content:flags.5?WebDocument send_message:BotInlineMessage = BotInlineResult;
botInlineMediaResult#17db940b flags:# id:string type:string photo:flags.0?Photo document:flags.1?Document title:flags.2?string description:flags.3?string send_message:BotInlineMessage = BotInlineResult;

messages.botResults#947ca848 flags:# gallery:flags.0?true query_id:long next_offset:flags.1?string switch_pm:flags.2?InlineBotSwitchPM results:Vector<BotInlineResult> cache_time:int users:Vector<User> = messages.BotResults;

exportedMessageLink#5dab1af4 link:string html:string = ExportedMessageLink;

messageFwdHeader#ec338270 flags:# from_id:flags.0?int from_name:flags.5?string date:int channel_id:flags.1?int channel_post:flags.2?int post_author:flags.3?string saved_from_peer:flags.4?Peer saved_from_msg_id:flags.4?int = MessageFwdHeader;

messages.botCallbackAnswer#36585ea4 flags:# alert:flags.1?true has_url:flags.3?true native_ui:flags.4?true message:flags.0?string url:flags.2?string cache_time:int = messages.BotCallbackAnswer;

messages.messageEditData#26b5dde6 flags:# caption:flags.0?true = messages.MessageEditData;

inputBotInlineMessageID#890c3d89 dc_id:int id:long access_hash:long = InputBotInlineMessageID;

inlineBotSwitchPM#3c20629f text:string start_param:string = InlineBotSwitchPM;


draftMessageEmpty#1b0c841a flags:# date:flags.0?int = DraftMessage;
draftMessage#fd8e711f flags:# no_webpage:flags.1?true reply_to_msg_id:flags.0?int message:string entities:flags.3?Vector<MessageEntity> date:int = DraftMessage;

messages.featuredStickersNotModified#04ede3cf = messages.FeaturedStickers;
messages.featuredStickers#f89d88e5 hash:int sets:Vector<StickerSetCovered> unread:Vector<long> = messages.FeaturedStickers;

messages.recentStickersNotModified#0b17f890 = messages.RecentStickers;
messages.recentStickers#22f3afb3 hash:int packs:Vector<StickerPack> stickers:Vector<Document> dates:Vector<int> = messages.RecentStickers;

messages.archivedStickers#4fcba9c8 count:int sets:Vector<StickerSetCovered> = messages.ArchivedStickers;

messages.stickerSetInstallResultSuccess#38641628 = messages.StickerSetInstallResult;
messages.stickerSetInstallResultArchive#35e410a8 sets:Vector<StickerSetCovered> = messages.StickerSetInstallResult;

stickerSetCovered#6410a5d2 set:StickerSet cover:Document = StickerSetCovered;
stickerSetMultiCovered#3407e51b set:StickerSet covers:Vector<Document> = StickerSetCovered;

inputStickeredMediaPhoto#4a992157 id:InputPhoto = InputStickeredMedia;
inputStickeredMediaDocument#0438865b id:InputDocument = InputStickeredMedia;

game#bdf9653b flags:# id:long access_hash:long short_name:string title:string description:string photo:Photo document:flags.0?Document = Game;

highScore#58fffcd0 pos:int user_id:int score:int = HighScore;

messages.highScores#9a3bfd99 scores:Vector<HighScore> users:Vector<User> = messages.HighScores;

textEmpty#dc3d824f = RichText;
textPlain#744694e0 text:string = RichText;
textBold#6724abc4 text:RichText = RichText;
textItalic#d912a59c text:RichText = RichText;
textUnderline#c12622c4 text:RichText = RichText;
textStrike#9bf8bb95 text:RichText = RichText;
textFixed#6c3f19b9 text:RichText = RichText;
textUrl#3c2884c1 text:RichText url:string webpage_id:long = RichText;
textEmail#de5a0dd6 text:RichText email:string = RichText;
textConcat#7e6260d7 texts:Vector<RichText> = RichText;
textSubscript#ed6a8504 text:RichText = RichText;
textSuperscript#c7fb5e01 text:RichText = RichText;
textMarked#034b8621 text:RichText = RichText;
textPhone#1ccb966a text:RichText phone:string = RichText;
textImage#081ccf4f document_id:long w:int h:int = RichText;
textAnchor#35553762 text:RichText name:string = RichText;

pageBlockUnsupported#13567e8a = PageBlock;
pageBlockTitle#70abc3fd text:RichText = PageBlock;
pageBlockSubtitle#8ffa9a1f text:RichText = PageBlock;
pageBlockAuthorDate#baafe5e0 author:RichText published_date:int = PageBlock;
pageBlockHeader#bfd064ec text:RichText = PageBlock;
pageBlockSubheader#f12bb6e1 text:RichText = PageBlock;
pageBlockParagraph#467a0766 text:RichText = PageBlock;
pageBlockPreformatted#c070d93e text:RichText language:string = PageBlock;
pageBlockFooter#48870999 text:RichText = PageBlock;
pageBlockDivider#db20b188 = PageBlock;
pageBlockAnchor#ce0d37b0 name:string = PageBlock;
pageBlockList#e4e88011 items:Vector<PageListItem> = PageBlock;
pageBlockBlockquote#263d7c26 text:RichText caption:RichText = PageBlock;
pageBlockPullquote#4f4456d3 text:RichText caption:RichText = PageBlock;
pageBlockPhoto#1759c560 flags:# photo_id:long caption:PageCaption url:flags.0?string webpage_id:flags.0?long = PageBlock;
pageBlockVideo#7c8fe7b6 flags:# autoplay:flags.0?true loop:flags.1?true video_id:long caption:PageCaption = PageBlock;
pageBlockCover#39f23300 cover:PageBlock = PageBlock;
pageBlockEmbed#a8718dc5 flags:# full_width:flags.0?true allow_scrolling:flags.3?true url:flags.1?string html:flags.2?string poster_photo_id:flags.4?long w:flags.5?int h:flags.5?int caption:PageCaption = PageBlock;
pageBlockEmbedPost#f259a80b url:string webpage_id:long author_photo_id:long author:string date:int blocks:Vector<PageBlock> caption:PageCaption = PageBlock;
pageBlockCollage#65a0fa4d items:Vector<PageBlock> caption:PageCaption = PageBlock;
pageBlockSlideshow#031f9590 items:Vector<PageBlock> caption:PageCaption = PageBlock;
pageBlockChannel#ef1751b5 channel:Chat = PageBlock;
pageBlockAudio#804361ea audio_id:long caption:PageCaption = PageBlock;
pageBlockKicker#1e148390 text:RichText = PageBlock;
pageBlockTable#bf4dea82 flags:# bordered:flags.0?true striped:flags.1?true title:RichText rows:Vector<PageTableRow> = PageBlock;
pageBlockOrderedList#9a8ae1e1 items:Vector<PageListOrderedItem> = PageBlock;
pageBlockDetails#76768bed flags:# open:flags.0?true blocks:Vector<PageBlock> title:RichText = PageBlock;
pageBlockRelatedArticles#16115a96 title:RichText articles:Vector<PageRelatedArticle> = PageBlock;
pageBlockMap#a44f3ef6 geo:GeoPoint zoom:int w:int h:int caption:PageCaption = PageBlock;

phoneCallDiscardReasonMissed#85e42301 = PhoneCallDiscardReason;
phoneCallDiscardReasonDisconnect#e095c1a0 = PhoneCallDiscardReason;
phoneCallDiscardReasonHangup#57adc690 = PhoneCallDiscardReason;
phoneCallDiscardReasonBusy#faf7e8c9 = PhoneCallDiscardReason;

dataJSON#7d748d04 data:string = DataJSON;

webDocument#1c570ed1 url:string access_hash:long size:int mime_type:string attributes:Vector<DocumentAttribute> = WebDocument;
webDocumentNoProxy#f9c8bcc6 url:string size:int mime_type:string attributes:Vector<DocumentAttribute> = WebDocument;

inputWebDocument#9bed434d url:string size:int mime_type:string attributes:Vector<DocumentAttribute> = InputWebDocument;

inputStickerSetItem#ffa0a496 flags:# document:InputDocument emoji:string mask_coords:flags.0?MaskCoords = InputStickerSetItem;

inputPhoneCall#1e36fded id:long access_hash:long = InputPhoneCall;

phoneCallEmpty#5366c915 id:long = PhoneCall;
phoneCallWaiting#1b8f4ad1 flags:# video:flags.5?true id:long access_hash:long date:int admin_id:int participant_id:int protocol:PhoneCallProtocol receive_date:flags.0?int = PhoneCall;
phoneCallRequested#87eabb53 flags:# video:flags.5?true id:long access_hash:long date:int admin_id:int participant_id:int g_a_hash:bytes protocol:PhoneCallProtocol = PhoneCall;
phoneCallAccepted#997c454a flags:# video:flags.5?true id:long access_hash:long date:int admin_id:int participant_id:int g_b:bytes protocol:PhoneCallProtocol = PhoneCall;
phoneCall#8742ae7f flags:# p2p_allowed:flags.5?true id:long access_hash:long date:int admin_id:int participant_id:int g_a_or_b:bytes key_fingerprint:long protocol:PhoneCallProtocol connections:Vector<PhoneConnection> start_date:int = PhoneCall;
phoneCallDiscarded#50ca4de1 flags:# need_rating:flags.2?true need_debug:flags.3?true video:flags.5?true id:long reason:flags.0?PhoneCallDiscardReason duration:flags.1?int = PhoneCall;

phoneConnection#9d4c17c0 id:long ip:string ipv6:string port:int peer_tag:bytes = PhoneConnection;

phoneCallProtocol#a2bb35cb flags:# udp_p2p:flags.0?true udp_reflector:flags.1?true min_layer:int max_layer:int = PhoneCallProtocol;

phone.phoneCall#ec82e140 phone_call:PhoneCall users:Vector<User> = phone.PhoneCall;

cdnPublicKey#c982eaba dc_id:int public_key:string = CdnPublicKey;

cdnConfig#5725e40a public_keys:Vector<CdnPublicKey> = CdnConfig;

channelAdminLogEventActionChangeTitle#e6dfb825 prev_value:string new_value:string = ChannelAdminLogEventAction;
channelAdminLogEventActionChangeAbout#55188a2e prev_value:string new_value:string = ChannelAdminLogEventAction;
channelAdminLogEventActionChangeUsername#6a4afc38 prev_value:string new_value:string = ChannelAdminLogEventAction;
channelAdminLogEventActionChangePhoto#434bd2af prev_photo:Photo new_photo:Photo = ChannelAdminLogEventAction;
channelAdminLogEventActionToggleInvites#1b7907ae new_value:Bool = ChannelAdminLogEventAction;
channelAdminLogEventActionToggleSignatures#26ae0971 new_value:Bool = ChannelAdminLogEventAction;
channelAdminLogEventActionUpdatePinned#e9e82c18 message:Message = ChannelAdminLogEventAction;
channelAdminLogEventActionEditMessage#709b2405 prev_message:Message new_message:Message = ChannelAdminLogEventAction;
channelAdminLogEventActionDeleteMessage#42e047bb message:Message = ChannelAdminLogEventAction;
channelAdminLogEventActionParticipantJoin#183040d3 = ChannelAdminLogEventAction;
channelAdminLogEventActionParticipantLeave#f89777f2 = ChannelAdminLogEventAction;
channelAdminLogEventActionParticipantInvite#e31c34d8 participant:ChannelParticipant = ChannelAdminLogEventAction;
channelAdminLogEventActionParticipantToggleBan#e6d83d7e prev_participant:ChannelParticipant new_participant:ChannelParticipant = ChannelAdminLogEventAction;
channelAdminLogEventActionParticipantToggleAdmin#d5676710 prev_participant:ChannelParticipant new_participant:ChannelParticipant = ChannelAdminLogEventAction;
channelAdminLogEventActionChangeStickerSet#b1c3caa7 prev_stickerset:InputStickerSet new_stickerset:InputStickerSet = ChannelAdminLogEventAction;
channelAdminLogEventActionTogglePreHistoryHidden#5f5c95f1 new_value:Bool = ChannelAdminLogEventAction;
channelAdminLogEventActionDefaultBannedRights#2df5fc0a prev_banned_rights:ChatBannedRights new_banned_rights:ChatBannedRights = ChannelAdminLogEventAction;
channelAdminLogEventActionStopPoll#8f079643 message:Message = ChannelAdminLogEventAction;

channelAdminLogEvent#3b5a3e40 id:long date:int user_id:int action:ChannelAdminLogEventAction = ChannelAdminLogEvent;

channels.adminLogResults#ed8af74d events:Vector<ChannelAdminLogEvent> chats:Vector<Chat> users:Vector<User> = channels.AdminLogResults;

channelAdminLogEventsFilter#ea107ae4 flags:# join:flags.0?true leave:flags.1?true invite:flags.2?true ban:flags.3?true unban:flags.4?true kick:flags.5?true unkick:flags.6?true promote:flags.7?true demote:flags.8?true info:flags.9?true settings:flags.10?true pinned:flags.11?true edit:flags.12?true delete:flags.13?true = ChannelAdminLogEventsFilter;

popularContact#5ce14175 client_id:long importers:int = PopularContact;

messages.favedStickersNotModified#9e8fa6d3 = messages.FavedStickers;
messages.favedStickers#f37f2f16 hash:int packs:Vector<StickerPack> stickers:Vector<Document> = messages.FavedStickers;

recentMeUrlUnknown#46e1d13d url:string = RecentMeUrl;
recentMeUrlUser#8dbc3336 url:string user_id:int = RecentMeUrl;
recentMeUrlChat#a01b22f9 url:string chat_id:int = RecentMeUrl;
recentMeUrlChatInvite#eb49081d url:string chat_invite:ChatInvite = RecentMeUrl;
recentMeUrlStickerSet#bc0a57dc url:string set:StickerSetCovered = RecentMeUrl;

help.recentMeUrls#0e0310d7 urls:Vector<RecentMeUrl> chats:Vector<Chat> users:Vector<User> = help.RecentMeUrls;

inputSingleMedia#1cc6e91f flags:# media:InputMedia random_id:long message:string entities:flags.0?Vector<MessageEntity> = InputSingleMedia;

inputMessageID#a676a322 id:int = InputMessage;
inputMessageReplyTo#bad88395 id:int = InputMessage;
inputMessagePinned#86872538 = InputMessage;

messages.foundStickerSetsNotModified#0d54b65d = messages.FoundStickerSets;
messages.foundStickerSets#5108d648 hash:int sets:Vector<StickerSetCovered> = messages.FoundStickerSets;

inputClientProxy#75588b3f address:string port:int = InputClientProxy;

help.proxyDataEmpty#e09e1fb8 expires:int = help.ProxyData;
help.proxyDataPromo#2bf7ee23 expires:int peer:Peer chats:Vector<Chat> users:Vector<User> = help.ProxyData;

help.termsOfServiceUpdateEmpty#e3309f7f expires:int = help.TermsOfServiceUpdate;
help.termsOfServiceUpdate#28ecf961 expires:int terms_of_service:help.TermsOfService = help.TermsOfServiceUpdate;

help.deepLinkInfoEmpty#66afa166 = help.DeepLinkInfo;
help.deepLinkInfo#6a4ee832 flags:# update_app:flags.0?true message:string entities:flags.1?Vector<MessageEntity> = help.DeepLinkInfo;

savedPhoneContact#1142bd56 phone:string first_name:string last_name:string date:int = SavedContact;

help.passportConfigNotModified#bfb9f457 = help.PassportConfig;
help.passportConfig#a098d6af hash:int countries_langs:DataJSON = help.PassportConfig;

inputAppEvent#1d1b1245 time:double type:string peer:long data:JSONValue = InputAppEvent;

jsonObjectValue#c0de1bd9 key:string value:JSONValue = JSONObjectValue;

jsonNull#3f6d7b68 = JSONValue;
jsonBool#c7345e6a value:Bool = JSONValue;
jsonNumber#2be0dfa4 value:double = JSONValue;
jsonString#b71e767a value:string = JSONValue;
jsonArray#f7444763 value:Vector<JSONValue> = JSONValue;
jsonObject#99c1d49d value:Vector<JSONObjectValue> = JSONValue;

pageTableCell#34566b6a flags:# header:flags.0?true align_center:flags.3?true align_right:flags.4?true valign_middle:flags.5?true valign_bottom:flags.6?true text:flags.7?RichText colspan:flags.1?int rowspan:flags.2?int = PageTableCell;

pageTableRow#e0c0c5e5 cells:Vector<PageTableCell> = PageTableRow;

pageCaption#6f747657 text:RichText credit:RichText = PageCaption;

pageListItemText#b92fb6cd text:RichText = PageListItem;
pageListItemBlocks#25e073fc blocks:Vector<PageBlock> = PageListItem;

pageListOrderedItemText#5e068047 num:string text:RichText = PageListOrderedItem;
pageListOrderedItemBlocks#98dd8936 num:string blocks:Vector<PageBlock> = PageListOrderedItem;

pageRelatedArticle#b390dc08 flags:# url:string webpage_id:long title:flags.0?string description:flags.1?string photo_id:flags.2?long author:flags.3?string published_date:flags.4?int = PageRelatedArticle;

page#ae891bec flags:# part:flags.0?true rtl:flags.1?true v2:flags.2?true url:string blocks:Vector<PageBlock> photos:Vector<Photo> documents:Vector<Document> = Page;

help.supportName#8c05f1c9 name:string = help.SupportName;

help.userInfoEmpty#f3ae2eed = help.UserInfo;
help.userInfo#01eb3758 message:string entities:Vector<MessageEntity> author:string date:int = help.UserInfo;

pollAnswer#6ca9c2e9 text:string option:bytes = PollAnswer;

poll#d5529d06 id:long flags:# closed:flags.0?true question:string answers:Vector<PollAnswer> = Poll;

pollAnswerVoters#3b6ddad2 flags:# chosen:flags.0?true option:bytes voters:int = PollAnswerVoters;

pollResults#5755785a flags:# min:flags.0?true results:flags.1?Vector<PollAnswerVoters> total_voters:flags.2?int = PollResults;

chatOnlines#f041e250 onlines:int = ChatOnlines;

statsURL#47a971e0 url:string = StatsURL;

chatAdminRights#5fb224d5 flags:# change_info:flags.0?true post_messages:flags.1?true edit_messages:flags.2?true delete_messages:flags.3?true ban_users:flags.4?true invite_users:flags.5?true pin_messages:flags.7?true add_admins:flags.9?true = ChatAdminRights;

chatBannedRights#9f120418 flags:# view_messages:flags.0?true send_messages:flags.1?true send_media:flags.2?true send_stickers:flags.3?true send_gifs:flags.4?true send_games:flags.5?true send_inline:flags.6?true embed_links:flags.7?true send_polls:flags.8?true change_info:flags.10?true invite_users:flags.15?true pin_messages:flags.17?true until_date:int = ChatBannedRights;

codeSettings#302f59f3 flags:# allow_flashcall:flags.0?true current_number:flags.1?true app_hash_persistent:flags.2?true app_hash:flags.3?string = CodeSettings;

emojiKeyword#d5b3b9f9 keyword:string emoticons:Vector<string> = EmojiKeyword;
emojiKeywordDeleted#236df622 keyword:string emoticons:Vector<string> = EmojiKeyword;

emojiKeywordsDifference#5cc761bd lang_code:string from_version:int version:int keywords:Vector<EmojiKeyword> = EmojiKeywordsDifference;

emojiURL#a575739d url:string = EmojiURL;

emojiLanguage#b3fb5361 lang_code:string = EmojiLanguage;

folder#ff544e65 flags:# autofill_new_broadcasts:flags.0?true autofill_public_groups:flags.1?true autofill_new_correspondents:flags.2?true id:int title:string photo:flags.3?ChatPhoto = Folder;

inputFolderPeer#fbd2c296 peer:InputPeer folder_id:int = InputFolderPeer;

folderPeer#e9baa668 peer:Peer folder_id:int = FolderPeer;

---functions---

messages.getServiceChats#b10e7d5f = messages.Dialogs;
messages.getMessages#63c66506 id:Vector<InputMessage> = messages.Messages;
messages.getHistory#dcbb8260 peer:InputPeer offset_id:int offset_date:int add_offset:int limit:int max_id:int min_id:int hash:int = messages.Messages;
messages.search#8614ef68 flags:# peer:InputPeer q:string from_id:flags.0?InputUser filter:MessagesFilter min_date:int max_date:int offset_id:int add_offset:int limit:int max_id:int min_id:int hash:int = messages.Messages;
messages.readHistory#0e306d3a peer:InputPeer max_id:int = messages.AffectedMessages;
messages.deleteHistory#1c015b09 flags:# just_clear:flags.0?true revoke:flags.1?true peer:InputPeer max_id:int = messages.AffectedHistory;
messages.deleteMessages#e58e95d2 flags:# revoke:flags.0?true id:Vector<int> = messages.AffectedMessages;
messages.deleteChat#83247d11 chat_id:int = Bool;
messages.receivedMessages#5a954c0 max_id:int = Vector<ReceivedNotifyMessage>;
messages.setTyping#a3825e50 peer:InputPeer action:SendMessageAction = Bool;
messages.sendMessage#fa88427a flags:# no_webpage:flags.1?true silent:flags.5?true background:flags.6?true clear_draft:flags.7?true peer:InputPeer reply_to_msg_id:flags.0?int message:string random_id:long reply_markup:flags.2?ReplyMarkup entities:flags.3?Vector<MessageEntity> = Updates;
messages.sendMedia#b8d1262b flags:# silent:flags.5?true background:flags.6?true clear_draft:flags.7?true peer:InputPeer reply_to_msg_id:flags.0?int media:InputMedia message:string random_id:long reply_markup:flags.2?ReplyMarkup entities:flags.3?Vector<MessageEntity> = Updates;
messages.forwardMessages#708e0195 flags:# silent:flags.5?true background:flags.6?true with_my_score:flags.8?true grouped:flags.9?true from_peer:InputPeer id:Vector<int> random_id:Vector<long> to_peer:InputPeer = Updates;
messages.reportSpam#cf1592db peer:InputPeer = Bool;
messages.hideReportSpam#a8f1709b peer:InputPeer = Bool;
messages.getPeerSettings#3672e09c peer:InputPeer = PeerSettings;
messages.report#fc4eb98b peer:InputPeer id:int reason:ReportReason message:string = Bool;
messages.getChats#3c6aa187 id:Vector<int> = messages.Chats;
messages.getFullChat#3b831c66 chat_id:int = messages.ChatFull;
messages.editChatTitle#dc452855 chat_id:int title:string = Updates;
messages.editChatPhoto#ca4c79d8 chat_id:int photo:InputChatPhoto = Updates;
messages.addChatUser#f9a0aa09 chat_id:int user_id:InputUser fwd_limit:int = Updates;
messages.deleteChatUser#e0611f16 chat_id:int user_id:InputUser = Updates;
messages.createChat#09cb126e users:Vector<InputUser> title:string = Updates;
messages.getDhConfig#26cf8950 version:int random_length:int = messages.DhConfig;
messages.requestEncryption#f64daf43 user_id:InputUser random_id:int g_a:bytes = EncryptedChat;
messages.acceptEncryption#3dbc0415 peer:InputEncryptedChat g_b:bytes key_fingerprint:long = EncryptedChat;
messages.discardEncryption#edd923c5 chat_id:int = Bool;
messages.setEncryptedTyping#791451ed peer:InputEncryptedChat typing:Bool = Bool;
messages.readEncryptedHistory#7f4b690a peer:InputEncryptedChat max_date:int = Bool;
messages.sendEncrypted#a9776773 peer:InputEncryptedChat random_id:long data:bytes = messages.SentEncryptedMessage;
messages.sendEncryptedFile#9a901b66 peer:InputEncryptedChat random_id:long data:bytes file:InputEncryptedFile = messages.SentEncryptedMessage;
messages.sendEncryptedService#32d439a4 peer:InputEncryptedChat random_id:long data:bytes = messages.SentEncryptedMessage;
messages.receivedQueue#55a5bb66 max_qts:int = Vector<long>;
messages.reportEncryptedSpam#4b0c8c0f peer:InputEncryptedChat = Bool;
messages.readMessageContents#36a73f77 id:Vector<int> = messages.AffectedMessages;
messages.getStickers#043d4f2c emoticon:string hash:int = messages.Stickers;
messages.getAllStickers#1c9618b1 hash:int = messages.AllStickers;
messages.getWebPagePreview#8b68b0cc flags:# message:string entities:flags.3?Vector<MessageEntity> = MessageMedia;
messages.exportChatInvite#0df7534c peer:InputPeer = ExportedChatInvite;
messages.checkChatInvite#3eadb1bb hash:string = ChatInvite;
messages.importChatInvite#6c50051c hash:string = Updates;
messages.getStickerSet#2619a90e stickerset:InputStickerSet = messages.StickerSet;
messages.installStickerSet#c78fe460 stickerset:InputStickerSet archived:Bool = messages.StickerSetInstallResult;
messages.uninstallStickerSet#f96e55de stickerset:InputStickerSet = Bool;
messages.startBot#e6df7378 bot:InputUser peer:InputPeer random_id:long start_param:string = Updates;
messages.getMessagesViews#c4c8a55d peer:InputPeer id:Vector<int> increment:Bool = Vector<int>;
messages.editChatAdmin#a9e69f2e chat_id:int user_id:InputUser is_admin:Bool = Bool;
messages.migrateChat#15a3b8e3 chat_id:int = Updates;
messages.searchGlobal#9e3cacb0 q:string offset_date:int offset_peer:InputPeer offset_id:int limit:int = messages.Messages;
messages.reorderStickerSets#78337739 flags:# masks:flags.0?true order:Vector<long> = Bool;
messages.getDocumentByHash#338e2464 sha256:bytes size:int mime_type:string = Document;
messages.searchGifs#bf9a776b q:string offset:int = messages.FoundGifs;
messages.getSavedGifs#83bf3d52 hash:int = messages.SavedGifs;
messages.saveGif#327a30cb id:InputDocument unsave:Bool = Bool;
messages.getInlineBotResults#514e999d flags:# bot:InputUser peer:InputPeer geo_point:flags.0?InputGeoPoint query:string offset:string = messages.BotResults;
messages.setInlineBotResults#eb5ea206 flags:# gallery:flags.0?true private:flags.1?true query_id:long results:Vector<InputBotInlineResult> cache_time:int next_offset:flags.2?string switch_pm:flags.3?InlineBotSwitchPM = Bool;
messages.sendInlineBotResult#b16e06fe flags:# silent:flags.5?true background:flags.6?true clear_draft:flags.7?true hide_via:flags.11?true peer:InputPeer reply_to_msg_id:flags.0?int random_id:long query_id:long id:string = Updates;
messages.getMessageEditData#fda68d36 peer:InputPeer id:int = messages.MessageEditData;
messages.editMessage#d116f31e flags:# no_webpage:flags.1?true peer:InputPeer id:int message:flags.11?string media:flags.14?InputMedia reply_markup:flags.2?ReplyMarkup entities:flags.3?Vector<MessageEntity> = Updates;
messages.editInlineBotMessage#83557dba flags:# no_webpage:flags.1?true id:InputBotInlineMessageID message:flags.11?string media:flags.14?InputMedia reply_markup:flags.2?ReplyMarkup entities:flags.3?Vector<MessageEntity> = Bool;
messages.getBotCallbackAnswer#810a9fec flags:# game:flags.1?true peer:InputPeer msg_id:int data:flags.0?bytes = messages.BotCallbackAnswer;
messages.setBotCallbackAnswer#d58f130a flags:# alert:flags.1?true query_id:long message:flags.0?string url:flags.2?string cache_time:int = Bool;
messages.getPeerDialogs#e470bcfd peers:Vector<InputDialogPeer> = messages.PeerDialogs;
messages.saveDraft#bc39e14b flags:# no_webpage:flags.1?true reply_to_msg_id:flags.0?int peer:InputPeer message:string entities:flags.3?Vector<MessageEntity> = Bool;
messages.getAllDrafts#6a3f8d65 = Updates;
messages.getFeaturedStickers#2dacca4f hash:int = messages.FeaturedStickers;
messages.readFeaturedStickers#5b118126 id:Vector<long> = Bool;
messages.getRecentStickers#5ea192c9 flags:# attached:flags.0?true hash:int = messages.RecentStickers;
messages.saveRecentSticker#392718f8 flags:# attached:flags.0?true id:InputDocument unsave:Bool = Bool;
messages.clearRecentStickers#8999602d flags:# attached:flags.0?true = Bool;
messages.getArchivedStickers#57f17692 flags:# masks:flags.0?true offset_id:long limit:int = messages.ArchivedStickers;
messages.getMaskStickers#65b8c79f hash:int = messages.AllStickers;
messages.getAttachedStickers#cc5b67cc media:InputStickeredMedia = Vector<StickerSetCovered>;
messages.setGameScore#8ef8ecc0 flags:# edit_message:flags.0?true force:flags.1?true peer:InputPeer id:int user_id:InputUser score:int = Updates;
messages.setInlineGameScore#15ad9f64 flags:# edit_message:flags.0?true force:flags.1?true id:InputBotInlineMessageID user_id:InputUser score:int = Bool;
messages.getGameHighScores#e822649d peer:InputPeer id:int user_id:InputUser = messages.HighScores;
messages.getInlineGameHighScores#0f635e1b id:InputBotInlineMessageID user_id:InputUser = messages.HighScores;
messages.getCommonChats#0d0a48c4 user_id:InputUser max_id:int limit:int = messages.Chats;
messages.getAllChats#eba80ff0 except_ids:Vector<int> = messages.Chats;
messages.getWebPage#32ca8f91 url:string hash:int = WebPage;
messages.reorderPinnedDialogs#3b1adf37 flags:# force:flags.0?true folder_id:int order:Vector<InputDialogPeer> = Bool;
messages.uploadMedia#519bc2b1 peer:InputPeer media:InputMedia = MessageMedia;
messages.sendScreenshotNotification#c97df020 peer:InputPeer reply_to_msg_id:int random_id:long = Updates;
messages.getFavedStickers#21ce0b0e hash:int = messages.FavedStickers;
messages.faveSticker#b9ffc55b id:InputDocument unfave:Bool = Bool;
messages.getUnreadMentions#46578472 peer:InputPeer offset_id:int add_offset:int limit:int max_id:int min_id:int = messages.Messages;
messages.readMentions#0f0189d3 peer:InputPeer = messages.AffectedHistory;
messages.getRecentLocations#bbc45b09 peer:InputPeer limit:int hash:int = messages.Messages;
messages.sendMultiMedia#2095512f flags:# silent:flags.5?true background:flags.6?true clear_draft:flags.7?true peer:InputPeer reply_to_msg_id:flags.0?int multi_media:Vector<InputSingleMedia> = Updates;
messages.uploadEncryptedFile#5057c497 peer:InputEncryptedChat file:InputEncryptedFile = EncryptedFile;
messages.searchStickerSets#c2b7d08b flags:# exclude_featured:flags.0?true q:string hash:int = messages.FoundStickerSets;
messages.getSplitRanges#1cff7e08 = Vector<MessageRange>;
messages.markDialogUnread#c286d98f flags:# unread:flags.0?true peer:InputDialogPeer = Bool;
messages.getDialogUnreadMarks#22e24e22 = Vector<DialogPeer>;
messages.clearAllDrafts#7e58ee9c = Bool;
messages.updatePinnedMessage#d2aaf7ec flags:# silent:flags.0?true peer:InputPeer id:int = Updates;
messages.sendVote#10ea6184 peer:InputPeer msg_id:int options:Vector<bytes> = Updates;
messages.getPollResults#73bb643b peer:InputPeer msg_id:int = Updates;
messages.getOnlines#6e2be050 peer:InputPeer = ChatOnlines;
messages.getStatsURL#812c2ae6 flags:# dark:flags.0?true peer:InputPeer params:string = StatsURL;
messages.editChatAbout#def60797 peer:InputPeer about:string = Bool;
messages.editChatDefaultBannedRights#a5866b41 peer:InputPeer banned_rights:ChatBannedRights = Updates;
messages.getEmojiKeywords#35a0e062 lang_code:string = EmojiKeywordsDifference;
messages.getEmojiKeywordsDifference#1508b6af lang_code:string from_version:int = EmojiKeywordsDifference;
messages.getEmojiKeywordsLanguages#4e9963b2 lang_codes:Vector<string> = Vector<EmojiLanguage>;
messages.getEmojiURL#d5b10c26 lang_code:string = EmojiURL;
messages.markReadAll#dddb336f = Bool;

help.getServerConfig#7217201a = DataJSON;
help.getConfig#c4f9186b = Config;
help.getNearestDc#1fb33026 = NearestDc;
help.getAppUpdate#522d5a7d source:string = help.AppUpdate;
help.getInviteText#4d392343 = help.InviteText;
help.getSupport#9cdf08cd = help.Support;
help.getAppChangelog#9010ef6f prev_app_version:string = Updates;
help.setBotUpdatesStatus#ec22cfcd pending_updates_count:int message:string = Bool;
help.getCdnConfig#52029342 = CdnConfig;
help.getRecentMeUrls#3dc0f114 referer:string = help.RecentMeUrls;
help.getProxyData#3d7758e1 = help.ProxyData;
help.getTermsOfServiceUpdate#2ca51fd1 = help.TermsOfServiceUpdate;
help.acceptTermsOfService#ee72f79a id:DataJSON = Bool;
help.getDeepLinkInfo#3fedc75f path:string = help.DeepLinkInfo;
help.getAppConfig#98914110 = JSONValue;
help.saveAppLog#6f02f748 events:Vector<InputAppEvent> = Bool;
help.getPassportConfig#c661ad08 hash:int = help.PassportConfig;
help.getSupportName#d360e72c = help.SupportName;
help.getUserInfo#038a08d3 user_id:InputUser = help.UserInfo;
help.editUserInfo#66b91b70 user_id:InputUser message:string entities:Vector<MessageEntity> = help.UserInfo;
help.test#c0e202f7 = Bool;

channels.readHistory#cc104937 channel:InputChannel max_id:int = Bool;
channels.deleteMessages#84c1fd4e channel:InputChannel id:Vector<int> = messages.AffectedMessages;
channels.deleteUserHistory#d10dd71b channel:InputChannel user_id:InputUser = messages.AffectedHistory;
channels.reportSpam#fe087810 channel:InputChannel user_id:InputUser id:Vector<int> = Bool;
channels.getMessages#ad8c9a23 channel:InputChannel id:Vector<InputMessage> = messages.Messages;
channels.getParticipants#123e05e9 channel:InputChannel filter:ChannelParticipantsFilter offset:int limit:int hash:int = channels.ChannelParticipants;
channels.getParticipant#546dd7a6 channel:InputChannel user_id:InputUser = channels.ChannelParticipant;
channels.getChannels#0a7f6bbb id:Vector<InputChannel> = messages.Chats;
channels.getFullChannel#08736a09 channel:InputChannel = messages.ChatFull;
channels.createChannel#f4893d7f flags:# broadcast:flags.0?true megagroup:flags.1?true title:string about:string = Updates;
channels.editAdmin#70f893ba channel:InputChannel user_id:InputUser admin_rights:ChatAdminRights = Updates;
channels.editTitle#566decd0 channel:InputChannel title:string = Updates;
channels.editPhoto#f12e57c9 channel:InputChannel photo:InputChatPhoto = Updates;
channels.checkUsername#10e6bd2c channel:InputChannel username:string = Bool;
channels.updateUsername#3514b3de channel:InputChannel username:string = Bool;
channels.joinChannel#24b524c5 channel:InputChannel = Updates;
channels.leaveChannel#f836aa95 channel:InputChannel = Updates;
channels.inviteToChannel#199f3a6c channel:InputChannel users:Vector<InputUser> = Updates;
channels.deleteChannel#c0111fe3 channel:InputChannel = Updates;
channels.exportMessageLink#ceb77163 channel:InputChannel id:int grouped:Bool = ExportedMessageLink;
channels.toggleSignatures#1f69b606 channel:InputChannel enabled:Bool = Updates;
channels.getAdminedPublicChannels#8d8d82d7 = messages.Chats;
channels.editBanned#72796912 channel:InputChannel user_id:InputUser banned_rights:ChatBannedRights = Updates;
channels.getAdminLog#33ddf480 flags:# channel:InputChannel q:string events_filter:flags.0?ChannelAdminLogEventsFilter admins:flags.1?Vector<InputUser> max_id:long min_id:long limit:int = channels.AdminLogResults;
channels.setStickers#ea8ca4f9 channel:InputChannel stickerset:InputStickerSet = Bool;
channels.readMessageContents#eab5dc38 channel:InputChannel id:Vector<int> = Bool;
channels.deleteHistory#af369d42 channel:InputChannel max_id:int = Bool;
channels.togglePreHistoryHidden#eabbb94c channel:InputChannel enabled:Bool = Updates;
channels.getLeftChannels#8341ecc0 offset:int = messages.Chats;

stickers.createStickerSet#9bd86e6a flags:# masks:flags.0?true user_id:InputUser title:string short_name:string stickers:Vector<InputStickerSetItem> = messages.StickerSet;
stickers.removeStickerFromSet#f7760f51 sticker:InputDocument = messages.StickerSet;
stickers.changeStickerPosition#ffb6d4ca sticker:InputDocument position:int = messages.StickerSet;
stickers.addStickerToSet#8653febe stickerset:InputStickerSet sticker:InputStickerSetItem = messages.StickerSet;

phone.getCallConfig#55451fa9 = DataJSON;
phone.requestCall#42ff96ed flags:# video:flags.0?true user_id:InputUser random_id:int g_a_hash:bytes protocol:PhoneCallProtocol = phone.PhoneCall;
phone.acceptCall#3bd2b4a0 peer:InputPhoneCall g_b:bytes protocol:PhoneCallProtocol = phone.PhoneCall;
phone.confirmCall#2efe1722 peer:InputPhoneCall g_a:bytes key_fingerprint:long protocol:PhoneCallProtocol = phone.PhoneCall;
phone.receivedCall#17d54f61 peer:InputPhoneCall = Bool;
phone.discardCall#b2cbc1c0 flags:# video:flags.0?true peer:InputPhoneCall duration:int reason:PhoneCallDiscardReason connection_id:long = Updates;
phone.setCallRating#59ead627 flags:# user_initiative:flags.0?true peer:InputPhoneCall rating:int comment:string = Updates;
phone.saveCallDebug#277add7e peer:InputPhoneCall debug:DataJSON = Bool;

folders.editPeerFolders#6847d0ab folder_peers:Vector<InputFolderPeer> = Updates;
folders.deleteFolder#1c295881 folder_id:int = Updates;
