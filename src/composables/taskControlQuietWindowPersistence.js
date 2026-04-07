export const persistQuietWindowSetting = async ({
  enabled,
  saveRemote,
  saveLocal,
}) => {
  const payload = { enabled: !!enabled };
  await saveRemote(payload);
  saveLocal(payload);
  return payload;
};
