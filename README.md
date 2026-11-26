# HerrasmiesKlubi Gaala

Järjestäjä: Default Settings Oy.

Kaveriporukan palkintogaalan äänestyssivu. Ei riippuvuuksia: tarvitaan vain Node.js 18 tai uudempi. Data tallentuu tiedostoon `data/db.json`.

## Miten äänestys etenee

| Vaihe | Mitä kaverit tekevät | Mitä admin tekee lopuksi |
| --- | --- | --- |
| 1. Kategoriaehdotukset | Ehdottavat kategorioita (oletuksena max 3/hlö). Omaa ehdotusta voi muokata ja poistaa ennen lukitusta. Tässä vaiheessa ei äänestetä. | Siirtää vaiheeseen 2. |
| 2. Kategoria-äänestys | Äänestävät, mitkä kategoriat pääsevät gaalaan (oletuksena 3 ääntä/hlö, max yksi per kategoria). "Vuoden sykähdyttävin hetki" on aina mukana. Lukitseminen vaatii vähintään yhden äänen. | Painaa "Valitse N eniten ääniä saanutta" (N = gaalan kategoriat − kiinteät) tai rastii käsin ja siirtää vaiheeseen 3. |
| 3. Ehdokasehdotukset | Ehdottavat ehdokkaita valitsemalla henkilökortin (osallistujat kuvineen) ja kirjoittamalla "Mistä?" – saman henkilön voi ehdottaa samaan kategoriaan eri aiheista (oletuksena max 2 ehdotusta/kategoria). Tässä vaiheessa ei äänestetä, eikä lukitseminen vaadi mitään. | Siirtää vaiheeseen 4 (jokaisessa kategoriassa pitää olla vähintään yksi ehdokas). |
| 4. Ehdokasäänestys | Valitsevat jokaisesta kategoriasta oman top 3:nsa napeilla 1. / 2. / 3. (1. sija = 3 p, 2. = 2 p, 3. = 1 p). Jos sijalla on jo joku, he vaihtavat paikkaa; uudelleen painaminen poistaa sijalta. Lukitseminen vaatii, että kaikki sijat on jaettu jokaisessa kategoriassa (vähemmän, jos kategoriassa on alle 3 ehdokasta). | Painaa "Valitse 3 eniten pisteitä saanutta jokaiseen" tai rastii finalistit käsin ja siirtää vaiheeseen 5. Tasapisteissä ratkaisee enemmän 1. sijoja, sitten 2. sijoja; jos sekin on tasan, hallinta varoittaa. |
| 5. Finaali | Valitsevat pystykorteista yhden voittajan per kategoria. Lukitseminen vaatii vähintään yhden äänen. | Siirtää vaiheeseen 6 (suljettu). |
| 6. Suljettu | Näkevät viestin, että äänestys on päättynyt, ja voivat jättää palautetta ("Anonyymi palaute": muut näkevät palautteet ilman nimeä, adminit näkevät kirjoittajan hallinnan palautelokista). | Näkee hallinnassa tulokset (voittajat, finaalin äänimäärät ja kuka äänesti ketä) ja voi kopioida ne tekstinä gaalan diaesitystä varten. Voi poistaa palautteita. |

Vaiheiden 1–5 lopussa on **Lukko sisään** -nappi. Kun osallistuja lukitsee vastauksensa, hän ei voi enää muuttaa sen vaiheen ehdotuksia tai ääniä, ja hänelle näytetään odotusnäyttö ("Seuraava vaihe ei ole vielä alkanut"), kunnes admin avaa seuraavan vaiheen. Lukitseminen on vahvistus, ei pakollinen: lukitsemattomatkin äänet lasketaan. Admin näkee osallistujataulukosta, ketkä ovat lukinneet, ja voi avata lukon ("Avaa lukko"), jos joku lukitsi vahingossa.

- Osallistujat eivät näe toistensa ääniä eivätkä sitä, kuka ehdotti mitä. Adminit näkevät ehdottajat, ehdokasäänestyksen pisteet ja sijajakauman (kuka antoi minkäkin sijan) sekä finaalin äänestäjät.
- Admin näkee osallistujataulukosta, montako ehdotusta tai ääntä kukin on käyttänyt tässä vaiheessa.
- Kuvat: admin lisää osallistujille kuvat osallistujataulukosta. Kuva näkyy henkilökorteissa ja ehdokaskorteissa. Yksittäiselle ehdokaskortille voi vaihtaa oman kuvan ehdokastaulukosta (esim. eri kuva eri kategoriassa). "Rajaa"-ikkunassa kuvaa voi vetää ja zoomata ja nähdä samalla esikatselun korteista; alkuperäinen kuva säilyy, joten rajausta voi muuttaa myöhemmin.
- Osallistujataulukon "Ehdokkaana"-ruudulla valitaan, näkyykö henkilö ehdotettavien henkilökorttien joukossa. Selain pienentää kuvan ennen lähetystä, ja kuvat näkyvät vain kirjautuneille. Kuvat tallentuvat `data/images`-kansioon.
- Äänimäärät näkee vain admin. Finaalin äänet ovat oletuksena piilossa myös adminilta, jotta voittajat ovat yllätys myös teille. Ne saa näkyviin valinnalla "Näytä finaalin äänet".
- Hallinnan asetuksista voi muuttaa gaalan kategoriamäärän, kategoria-äänestyksen äänet, finalistien määrän, ehdotusrajat ja näkyvän takarajan.
- Vanhempien versioiden tietokanta muunnetaan automaattisesti uusiin vaihenumeroihin palvelimen käynnistyessä (4 ja 5 vaihetta → 6 vaihetta). Lukitukset, avauspyynnöt, palautteet ja päättymisajat siirtyvät oikeille vaiheille; vanhan ehdokasvaiheen äänet poistetaan, koska ehdotusvaiheessa ei enää äänestetä.
- Admin voi palata aiempaan vaiheeseen sekä poistaa asiattomia ehdotuksia.

## Hall of Fame

Yläpalkin **Hall of Fame** -napista aukeaa sivu, jolla näkyvät aiempien vuosien gaalat uusin ensin: jokaisesta kategoriasta voittaja (tasapelissä jaettu voitto) isona korttina ja muut ehdokkaat sen alla. Sivu on aluksi **piilossa muilta**: vain adminit näkevät sen (napissa merkki "piilossa"), joten sitä voi rakentaa rauhassa. Kun Hall of Fame on valmis, admin painaa sivun yläosan Näkyvyys-paneelista **Julkaise Hall of Fame**, jolloin se näkyy kaikille kirjautuneille. Samasta paneelista sen saa taas piiloon (**Piilota muilta**). Piilotettuna osallistujille ei lähetetä Hall of Famen sisältöä lainkaan. Kun vuosia on useampi, ne ovat välilehtinä (uusin valittuna). Valittu vuosi näkyy osoitteessa, esim. `/#hall-of-fame/2025`, joten linkin tiettyyn vuoteen voi jakaa.

Adminit hallitsevat sivua sen alalaidasta:

- **Lisää aiempi gaala**: lomake, jossa annetaan vuosi ja lisätään kategoriat (nimi ja valinnainen kuvaus). Jokaiseen kategoriaan valitaan ehdokkaat osallistujalistasta (kortissa näkyy osallistujan kuva) tai valinnalla "Joku muu…" kirjoitetaan nimi itse. Lisäksi voi kertoa, mistä ehdokas oli ehdolla. Voittaja merkitään "★ Voittaja" -valinnalla, ja tasapelissä niitä voi merkitä useamman. Tyhjiksi jätetyt ehdokasrivit ohitetaan tallennettaessa.
- **Kuvat**: Hall of Famen kuvat ovat omiaan, eivät osallistujien profiilikuvia. Kuva lisätään lomakkeella klikkaamalla rivin pyöreää kuvaa, raahaamalla kuva riville tai liittämällä se leikepöydältä (klikkaa riviä, esim. "Mistä?"-kenttää, ja paina Ctrl+V). Myös Google Slidesistä ja Docsista kopioidut kuvat toimivat: niiden leikepöydällä on vain linkki Googlen kuvapalvelimelle, joten gaalan palvelin hakee kuvan sieltä (vain Googlen kuvapalvelimilta, palvelimella pitää olla nettiyhteys), jolloin rajausikkuna aukeaa (sama kuin profiilikuvissa: vedä ja zoomaa, esikatselu korteista). Rajauksen voi muuttaa myöhemmin rivin "Rajaa"-linkistä. Kuva ja rajaus tallentuvat "Tallenna gaala" -napista. Osallistujan poisto tai profiilikuvan vaihto ei vaikuta Hall of Famen kuviin. Alle K18 -tilassa kuvien tilalla näkyy nimikirjain. Kuvat tallentuvat `data/images`-kansioon muiden kuvien tapaan.
- **Lisää gaala [vuosi] Hall of Fameen**: kun äänestys on suljettu (vaihe 6), tämän vuoden finalistit ja voittajat siirtyvät Hall of Fameen yhdellä napilla (ehdokaskorttien omat kuvat rajauksineen kopioidaan mukaan; profiilikuvia ei käytetä, joten puuttuvat kuvat lisätään muokkaamalla vuotta). Tee tämä ennen kuin nollaat gaalan seuraavaa vuotta varten. Nollaus ei poista Hall of Famea.
- **Kansikuva**: jokaiselle vuodelle voi lisätä kansikuvan (esim. ryhmäkuva gaalasta), joka näkyy "Gaala 2025" -otsikon alla. Se lisätään lomakkeen yläosasta samoilla tavoilla kuin ehdokkaiden kuvat (klikkaus, raahaus tai liittäminen) ja rajataan leveään 16:9-muotoon. Alle K18 -tilassa kansikuva on piilossa.
- Tallennettuja vuosia voi muokata ja poistaa.



## Palkintosivut ja QR-koodit

Jokaisella Gaalaan päässeellä kategorialla on oma **palkintosivu** osoitteessa `/p/<tunniste>`, jonka QR-koodin voi tulostaa pokaalin pohjaan. Sivulla on kategorian nimi ja palkintokoroke: 2. sija vasemmalla, 1. keskellä korkeimmalla ja 3. oikealla, kuvineen. Sivu näkyy **ilman kirjautumista**, mutta muualta sivustolta ei ole sinne linkkiä. Tunniste on satunnainen, joten sivuja ei voi arvata.

- Hallinnassa (**Palkintosivut ja QR-koodit**) on jokaisen kategorian QR-koodi, linkki ja PNG-lataus (1200 px) sekä **Tulosta kaikki QR-koodit** -arkki.
- **Lataa SVG (3D)** tekee 3D-mallinnukseen sopivan SVG:n (esim. Fusion 360: Insert → Insert SVG): koodin sivun pituus millimetreinä (oletus 53 mm, mitattuna reunimmaisten ruutujen ulkoreunoista; koodin kulma on SVG:n origossa ja ympärille kannattaa jättää vähintään 4 ruudun levyinen tyhjä alue). Koordinaatit ovat valmiiksi pikseleinä (96 px = 25,4 mm), koska Fusion 360 ei huomioi SVG:n mm-yksikköä, tummat ruudut yhtenäisinä ääriviivoina ilman taustaa. **Lataa kaikki SVG:t** lataa koko vuoden kerralla. Tarkista **QR-koodien osoite** (Funnelin osoite) ennen tulostamista.
- Ennen julkaisua sivulla lukee "Voittaja julkistetaan Gaalassa". **Julkaise tulokset** paljastaa sijat kaikilla sivuilla; auki olevat sivut päivittyvät itsestään.
- Sijat tulevat finaalin äänimääristä (tasapelissä sama sija). **Muokkaa sijoja** asettaa ne käsin.
- Kun vuosi arkistoidaan Hall of Fameen, sijat ja tunnisteet siirtyvät mukaan, joten pokaalin QR-koodi toimii jatkossakin. Hall of Famen lomakkeessa jokaiselle ehdokkaalle voi valita sijan (1. = voittaja), ja myös aiemmille vuosille syntyy palkintosivut.
- Palkintosivulta pääsee **Hall of Fameen** (vaatii kirjautumisen) ja sieltä **takaisin palkintosivulle**.
- QR-koodit tehdään selaimessa kirjastolla `public/vendor/qrcode.js` (qrcode-generator 1.4.4, MIT).
## Discord-ilmoitukset

Palvelin voi lähettää tapahtumista ilmoituksen adminien Discord-kanavalle **webhookin** kautta (pelkkä HTTPS-pyyntö, ei bottia).

1. Discordissa: kanavan asetukset → **Integraatiot → Webhookit → Uusi webhook** → **Kopioi webhookin URL**.
2. Gaalan hallinnassa: **Discord-ilmoitukset** → liitä osoite → **Tallenna ilmoitusasetukset** → **Lähetä testiviesti**.

Osoite on salaisuus: se tallennetaan palvelimelle (`data/db.json`) eikä sitä näytetä selaimessa tallennuksen jälkeen. Vaihtoehtoisesti sen voi antaa ympäristömuuttujana `DISCORD_WEBHOOK`.

Ilmoitukset (kunkin tyypin voi kytkeä pois hallinnasta):
- **Virheet:** epäonnistuneet kuvalataukset (käyttäjä, tiedosto, virhe, selain) ja palvelinvirheet
- **Lukon avauspyynnöt:** osallistuja painaa odotusnäytöllä **Pyydä lukon avausta** → ilmoitus kertoo kuka ja mistä vaiheesta. Pyyntö näkyy myös hallinnassa ("Lukon avausta pyytää" ja merkki Avaa lukko -napissa) ja poistuu, kun lukko avataan.
- **Lukitukset:** kuka lukitsi ja montako on lukinnut, ilmoitus kun kaikki ovat lukinneet, adminin avaamat lukot
- **Vaiheen vaihtuminen**, **palautteet** (kirjoittajan nimellä) ja **kuvaehdotukset**
- **Muistutukset** vaiheissa 1–5: lukitsemattomien lista kerran päivässä valittuun aikaan (oletus 18:00), 24 h ja 2 h ennen vaiheen päättymistä sekä päättymisajan mentyä. Ajat ovat Suomen aikaa (`GAALA_TZ`, oletus `Europe/Helsinki`).

Jos webhookia ei ole asetettu, ilmoitukset ovat pois päältä. Discordin katko ei vaikuta gaalaan.

### Julkinen päivittäinen tiedote

Toinen, erillinen webhook osallistujien kanavalle (hallinta → **Julkinen päivittäinen tiedote**). Vaiheissa 1–5 palvelin lähettää kerran päivässä valittuun aikaan (oletus 12:00) virallisen kaksikielisen tiedotteen: montako jäsentä on lyönyt vaiheen lukkoon ja paljonko aikaa vaiheen päättymiseen on (tänään / huomenna / N päivää, vaiheen päättymisajan mukaan). Kummankin kielen kappaleen perään listataan ne, jotka eivät ole vielä lukinneet (paitsi jos kukaan ei ole vielä lukinnut, jolloin listassa olisivat kaikki). Nimilistan saa pois asetuksesta "Listaa tiedotteessa lukitsemattomien nimet". Kohdassa "Ei mukana tiedotteessa" voi rajata pois esim. adminit, jotka ehdottavat mutta eivät äänestä: he eivät näy tiedotteen lukumäärissä eivätkä nimilistassa (adminien kanavan muistutuksiin rajaus ei vaikuta). Lopussa on allekirjoitus ja maininta automaattisesta viestistä. Pingattavan roolin (esim. @Gaala-jäsenet) voi asettaa roolin ID:llä; muuten ketään ei pingata. Hallinnassa tekstin voi esikatsella ja lähettää heti (**Lähetä nyt**).
## Ehdokkaiden videot

Vaiheessa 3 jokaiseen ehdotukseen voi liittää useita kuvia ja videoita sekaisin (enintään 6) puhelimesta (iPhone, Android) tai tietokoneelta. Hallinnan kategoriataulukossa valitaan jokaiselle kategorialle **Ehdotuksen liite**: vapaaehtoinen, kuva tai video pakollinen (vähintään yksi liite), tai video pakollinen (vähintään yksi video, esim. Vuoden videoklippi).

- Kortissa näkyy viimeisimmäksi lisätty valmis video. Jos videota ei ole, kortissa näkyy viimeisin kuva profiilikuvan tilalla (Alle K18 -tilassa henkilön <18-kuva, kuten muissakin ehdokaskorteissa). Kortin kulmassa näkyy liitteiden määrä.
- Kortin kuva-alueen klikkaus avaa ison ruudun, jossa ovat ehdokkaan kaikki videot ja kuvat (nuolet ja pikkukuvarivi).
- Kuvat käsitellään kuten profiilikuvat (myös iPhonen HEIC) ja lähtevät palvelimelle ehdotuksen mukana.

- Lähetys alkaa heti, kun video on valittu, joten se on yleensä perillä, kun peruste on kirjoitettu. Ennen ehdottamista video on luonnos, jonka näkee vain lähettäjä; liittämättömät luonnokset poistuvat 12 tunnin kuluttua (enintään 4 kerrallaan per osallistuja).
- Videollinen ehdokaskortti näyttää videon profiilikuvan tilalla vaiheissa 3–5. Hiiri kortin päällä → video pyörii kortissa (äänet voi kytkeä pois kategorian otsikosta), kuvan klikkaus → iso ruutu, jossa nuolilla saman kategorian muut videot. Finaalissa videon avaaminen ei äänestä, vaan ääni annetaan Valitse-kohdasta.
- Ehdokkaiden videot näkyvät kaikille kirjautuneille. Kun ehdotus poistetaan, video poistuu sen mukana.
- Testikäyttäjän video kokeillaan vain omassa selaimessa, eikä sitä lähetetä palvelimelle.
- Adminin Videot-sivulla näkyvät myös ehdokkaiden videot (merkintä "Ehdotus · kategoria"). Sieltä poistettu video irrotetaan ehdokkaasta.

## Videot (testi, vain adminit)

Hallinnan paneelista **Videot** avautuu sivu, jolla adminit lisäävät osallistujille videoklippejä (esim. kategoriaan Vuoden videoklippi). Toistaiseksi videot näkyvät vain admineille.

- **Lisää videoita:** osallistujakortit. Kortin painaminen avaa ikkunan, jossa voi antaa otsikon ja valita videon puhelimesta (iPhone, Android: galleria tai kamera) tai tietokoneelta. Lähetyksen edistyminen näkyy prosentteina. Otsikkoa voi muuttaa ja videon poistaa.
- **Esikatselu:** jokainen video omana korttinaan. Kun hiiri on kortin päällä, video pyörii kortissa äänettömänä; klikkaus avaa sen isolle ruudulle äänen kanssa (nuolilla seuraava/edellinen, Esc sulkee). Kosketusnäytöllä napautus avaa ison ruudun suoraan.
- Video lähetetään raakana tiedostona, ja palvelin kirjoittaa sen suoraan levylle, joten isokaan video ei täytä muistia. Enimmäiskoko on 500 Mt (`VIDEO_MAX_MB`).
- Palvelin muuntaa videon taustalla ffmpegillä muotoon, joka toistuu kaikissa selaimissa (H.264 + AAC MP4, pidempi sivu enintään 1280 px eli `VIDEO_MAX_SIDE`, enintään 30 kuvaa/s). iPhonen HEVC- ja HDR-videot muunnetaan tavallisiksi, jotta ne eivät näytä haalealta, ja sijaintitiedot (GPS) yms. metatiedot poistetaan. Videosta otetaan kansikuva korttiin. Muunnos ajetaan matalalla prioriteetilla yksi kerrallaan, joten sivu toimii sen aikana normaalisti.
- Docker-kuva asentaa ffmpegin. Ilman ffmpegiä (esim. systemd-asennus ilman `apt install ffmpeg`) video tallennetaan sellaisenaan, jolloin iPhonen HEVC-video ei toistu kaikissa selaimissa.
- Videot ovat kansiossa `data/videos` (samassa volyymissa kuin `db.json`). Ne vievät levytilaa: palvelin kieltäytyy lähetyksestä, jos levyllä ei ole tilaa.

## Käynnistys

```bash
cp .env.example .env      # vaihda ADMIN_CODE (vähintään 8 merkkiä)
node server.js            # tai: npm start
```

Sivu aukeaa osoitteessa `http://127.0.0.1:3000`.

Kun sivu on käynnissä:

1. Kirjaudu sisään `ADMIN_CODE`:lla. Ylläpitotunnuksella voi vain hallinnoida, ei äänestää.
2. Lisää hallinnassa kaikki osallistujat, myös itsenne. Kirjoita nimet pilkuilla tai riveittäin erotettuna, jolloin jokainen saa oman koodin (muotoa `HB95-GHNB`).
3. Rastikaa itsellenne Admin ja kirjautukaa jatkossa omilla koodeillanne.
4. Lähetä jokaiselle kaverille hänen oma linkkinsä ("Kopioi linkki"). Linkki kirjaa kaverin sisään suoraan. Vaihtoehtoisesti kaveri voi kirjoittaa koodinsa kirjautumissivulle.

Koodi on henkilökohtainen, joten äänirajat ja anonymiteetti toimivat koodin kautta. Jos koodi leviää väärälle henkilölle, "Uusi koodi" mitätöi vanhan heti. Kymmenen väärää koodia kymmenen minuutin sisällä estää kirjautumisen samasta osoitteesta hetkeksi.

### Pysyvästi päälle (systemd)

```ini
# /etc/systemd/system/gaala.service
[Unit]
Description=HerrasmiesKlubi Gaala
After=network.target

[Service]
WorkingDirectory=/opt/gaala
ExecStart=/usr/bin/node server.js
Restart=always
User=gaala

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gaala
```

### Tai Dockerilla

```bash
docker build -t gaala .
docker run -d --name gaala --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v gaala-data:/app/data \
  -e ADMIN_CODE=... gaala
```

## Jakaminen Tailscalella

Palvelin kuuntelee vain osoitetta `127.0.0.1`, joten se ei näy suoraan verkkoon. Tailscale välittää sen tailnetiin HTTPS:llä:

```bash
tailscale serve --bg 3000
tailscale serve status    # näyttää osoitteen, esim. https://palvelin.tailXXXX.ts.net
```

Kaverit pääsevät sivulle kahdella tavalla:

- **Samaan tailnetiin:** kutsu heidät Tailscalen admin-konsolissa (Users → Invite).
- **Jaa vain tämä kone:** admin-konsolissa koneen kohdalla Share… Kaverit tarvitsevat oman ilmaisen Tailscale-tilin, mutta eivät näe muita koneitanne.

Jos kaverit näkevät tailnetissä muitakin koneita, rajatkaa pääsy ACL:llä pelkästään tähän koneeseen ja porttiin 443.

**Älä käytä `tailscale funnel` -komentoa.** Se avaa sivun koko internetiin. Henkilökohtaiset koodit suojaavat silti sisäänkirjautumisen, mutta pelkkä tailnet on turvallisempi.

## Varmuuskopio ja nollaus

- Kaikki data on tiedostossa `data/db.json`, kuvat kansiossa `data/images` ja videot kansiossa `data/videos`. Varmuuskopioksi riittää `data`-kansion kopioiminen.
- Jos haluatte aloittaa alusta, pysäyttäkää palvelin ja poistakaa `data/db.json`.
- Kadonneen koodin näkee hallinnan osallistujataulukosta.

## Tiedostot

- `server.js` – palvelin ja API (vain Noden omat moduulit)
- `public/index.html`, `public/app.js` – käyttöliittymä
- `public/styles.css` – ulkoasu (tumma gaalateema)
- `public/logo.svg` – logo (pokaali), myös välilehden kuvake
