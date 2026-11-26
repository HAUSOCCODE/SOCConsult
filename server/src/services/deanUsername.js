export const normalizeUsername = (value = "") => value.trim().toLowerCase();

export function validDeanUsername(username) {
  if (username.length < 3 || username.length > 100) return false;
  const local = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/;
  const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;
  const [name, host, extra] = username.split("@");
  return local.test(name) && (host === undefined || (
    extra === undefined && name.length <= 64 &&
    domain.test(host) && host.split(".").every(label => label.length <= 63)
  ));
}
