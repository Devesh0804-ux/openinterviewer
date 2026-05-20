import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: process.env.NEXT_PUBLIC_KEYCLOAK_URL || "https://keycloak-24-0-5-9yaq.onrender.com",
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "bharattech",
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "openinterviewer-client",
});

export default keycloak;
