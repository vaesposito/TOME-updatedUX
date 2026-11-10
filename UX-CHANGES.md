# UX changes

This is a reader's account of the user-experience work on the `notification-ux`
branch, grouped by the part of TOME it affects rather than by the order it was
written. Everything below is a difference someone would notice while using the
product: a new surface, a thing that moved, a word that changed, or an answer
the interface now gives that it used to leave to guesswork. Internal
refactoring, tests and documentation are left out.

## The catalogue and its two axes

TOME used to open onto a single grid of project cards. It now registers as its
own section in the application navigation, alongside the other product areas,
and lists its destinations before a reader arrives rather than hiding them in a
tab bar they only meet once they are inside. The same set of destinations is
offered twice, once in the navigation and once as the tab bar under the welcome
band, so collapsing the navigation no longer costs a reader a view, and every
reading of the portfolio has its own address that can be linked to and shared.

There are now two ways to read the catalogue. **By project** is the original
hierarchy of big goals, areas and projects. **By function** is new: it groups
spaces by the part of the organisation that owns them, with each function
divided into categories and each category holding the spaces filed under it.
The two readings share their chrome deliberately — the same group headings, the
same collapsing levels, the same project cards, the same toolbar with a count on
the left and one search field and one add button on the right — so a reader
learns the catalogue once and then changes the vocabulary rather than the
interface. A function's list is fixed rather than derived from whatever happens
to be tagged, because a function with nothing in it yet is exactly the answer
someone opened the view to find. Spaces with no function gather at the bottom as
a number to be fixed, not as a sixth part of the organisation, and a category's
name leads to a page of its own that reads like the hub.

A space sits on exactly one axis, and the two lists are disjoint: a record that
appears under By project does not appear under By function. The trail above a
space climbs whichever axis it actually belongs to, so a subject reads as
function and category rather than being shown a goal it was never under.
Categories can be supplied by a deployment's own configuration so that they
exist the first time someone opens TOME, renaming one in configuration reads as
a rename rather than leaving the old name behind, and anything a person tagged
by hand is never thrown away by a configuration change. A reader filing a space
can also name a function or category that does not exist yet, straight from the
field, and the form says plainly when a typed name is a new one rather than a
choice from the list.

Group headings became quieter and more direct. A group that has a wiki of its
own is opened by clicking its name, which now carries an underline and an arrow
on hover, instead of by a bordered, tinted button sitting an inch away
repeating the name. The offer to create a wiki for a group that lacks one waits
for hover rather than standing permanently beside every group. On a project card
the title gets the full row and the last-changed date sits beside the steward,
so ownership and recency read together, and the list of source counts is gone.
Who keeps a space, when it last changed, whether it refreshes itself and whether
it can be trusted today are now answered the same way on every surface that
answers them, and age on its own is no longer treated as a complaint against a
hand-written page.

The toolbar lost the things that were not helping. The grouping dropdown is gone
because projects are read by the goal they belong to, though an existing grouped
link still works. The help button beside the search field is gone. The
onboarding wizard's card-sized trigger became an "Add project" button the size
of its neighbours, and every control in the toolbar now stands at the same
height.

## Creating a space

The seven-step onboarding wizard is replaced by a three-step flow: what the
space is called, what it reads, and who is in it. The steps are named in the
header with the current one marked and the finished ones told apart from the
ones still ahead, and each step's title heads its own panel. Where the space
goes is one question with two answers — a project picks its goal and area, a
subject picks its function and category — and neither sees the other axis's
options. A top-level goal is asked for no parent, and "not placed" is something
a reader chooses rather than what happens when they say nothing. Each of those
two fields takes a row of its own, rather than sharing one row at half the width
of the name field above them, so the step keeps a single rhythm all the way down
and reads the same on either axis. Inviting people
is switched off, with a line saying why, for a reader who does not administer
the owning team. Repositories can be attached during creation; other sources are
attached afterwards from the space's own settings, where they can be picked from
a connected account. Ingest schedules default to weekly and can now be set to
run hourly, and the scheduled-ingest switch draws the same tick the rest of the
product uses instead of looking like a pressed button.

A brand-new space is founded on a single page written by the agent rather than
arriving with empty placeholder documents, so nothing on its Home offers to open
a page that was never created.

## A space's Home

The landing view of a goal, an area or a project used to be a digest of recent
notifications: it said what had happened without saying what the space was.
Home replaces it and answers the questions people actually arrive with, as a
set of cards:

- An **ask box** at the top, tinted so a reader with a question finds it before
  they find anything else. What is typed there is carried into the agent's chat
  and sent, rather than making the reader open the chat and type it again.
- **At a glance**, which carries the space's own recap: the headline in full,
  with progress, blockers and what is up next.
- **Needs attention**, **Tagged for you** and **Latest updates**, which divide
  the recent activity between them by what a reader would do with each item, so
  nothing is counted three times. Each of them leads into the notification inbox
  already narrowed to this space.
- **Team**, with the owning team's roster and roles, the steward who can edit,
  and how many people are actually following.
- **Sources**, listing every connected repository, space and room, named exactly
  as the ingest panel names them.
- **Milestones** and **KPIs**, read off the roadmap and charter pages where a
  team agrees them, shown as written rather than reinterpreted.

The cards run in three bands, ordered by what changes rather than by what fits
the grid: what has just happened comes first, because it is the only part that
can be waiting on the reader; how the work is going comes next; and the roster,
the sources and the KPIs sit last as one row of three, so the shelf of things
that rarely change reads as a single row to skip.

A reader can also rearrange the page. "Customize" turns each card into
something with a handle and an eye: dragging moves it, the eye puts it away, and
anything put away is offered back by name from a bar that, when closed, is a
single quiet button saying how many cards are hidden. The arrangement is stored
as the order chosen plus the set put away, so a card added in a later release
arrives as new rather than as unwanted, and a card brought back returns to where
it was. One arrangement covers every space, including the hub's own Overview, so
hiding a card in one place hides it everywhere.

Empty is now one shape across the whole page, and it cannot be mistaken for
content: a dashed ring holding the card's icon, a few words for what is missing,
one line for what would fill it, and a button that goes and does that. Waiting
is visibly different from empty — the cards draw the rows they are about to hold
instead of announcing that nothing needs attention a moment before finding out
that something does — and the two cards that read from the network can be
retried in place rather than by reloading the page.

A goal or an area gets a home that says what is below it rather than one built
for a single project. It gains an "Areas & projects" card listing each child
with what is waiting in it, how much of it is written, when it last moved and
whether an ingest is running, and it says when the list is partial rather than
understating the portfolio. Sources and People became roll-ups wherever they are
read above a single project: one line per system across the whole subtree, with
duplicates counted once, the spaces they came from, and the subtree's last
ingest; and the stewards, owners and teams of the children, each named once. A
"Part of" card answers the question the page never did — what this space belongs
to — reading the breadcrumb's trail across, and is left out at the top of the
tree rather than answering emptily. The feed cards say the scale they are
reporting at by naming how many spaces their rows came from, and the wording of
the empty states is written for a container that synthesizes rather than for a
project that connects repositories.

## A space's Overview

Overview carries the space's story. "Changed this week" reads the space's own
feed over a seven-day window and folds related events together, so a run that
started, finished and was reviewed reads as one change rather than three. "Open
decisions" lists what is still undecided and drops anything already accepted or
rejected, with a decision rolled up from a space below linking down to it.
"About" carries the description in full, where the header previously showed one
clipped line of it behind a hover, and the title row now holds only the title.
"At a glance" shows the recap as written. "Sources" says when the space was last
read and when it will be read next. The same arranging that works on Home works
here.

From the hub's portfolio-wide Overview, following a row opens it in a new tab,
so the survey a reader is working through stays where it was instead of being
replaced by the one thing they clicked. On a space's own Home a row still opens
in place, because there it is a step further into what is already being read.

## The space navigation and its settings

Behind an opt-in switch, the project rail becomes a short list of destinations —
Overview, Wiki, Meetings, Issues, Notes, Connections and, set apart below,
Settings — instead of eight destinations, three report views, a label list and a
page tree with five page actions wedged into its heading. Nothing was taken
away: the agent is still the chat bubble in the corner, ingest moved into
Settings, and the page actions moved to where pages are administered. The
switch itself can be reached from two places a reader might be standing when
they wonder what the new navigation looks like: the interface preferences in
Appearance, and the hub's own action row, where it reads On or Off at a glance.

Every first-level row in the rail now behaves the same way. Clicking a row goes
somewhere, and the caret beside it opens or closes what is underneath; rows with
nothing under them hold the caret's column open so the icons and labels still
line up, but draw no caret that would promise something to open. Wiki and
Connections each gained a landing view listing what they hold, so there is
somewhere for them to go, and the same view serves a folder. Every section and
every folder carries a count, zero included, in one column with figures that
line up — and nothing at all while the count is still unknown, since a zero
shown while loading is a count and the wrong one. Issues and Notes are counted
too, which were the two rows a reader was most likely to find empty and the two
that used to make them click to find out.

The tree itself reads better. Carets moved to the trailing edge at both levels,
so the whole sidebar opens and closes from one edge and icons and labels start
together all the way down. An opened section draws a guide line from its own
icon down through its contents, and its contents hang under the section's label
rather than under its icon. Folders are told apart by a folder mark, a gap above
them and a heavier label rather than by small uppercase type at a different
size, a nesting step is wide enough to see without looking for it, and a child
page clears its parent folder's title instead of sitting exactly beneath it.
Folders start closed, except the branch holding the page a reader has just
followed a link into. Dimness is spent on emptiness alone, so a source nothing
has been read from is lighter than one that has content. The search box left
both wiki sidebars: a tree most spaces can show whole does not need filtering in
the column where it is being navigated, and searching stays where pages are
surveyed in bulk.

What a space reads is now grouped by the system it came from. A single
**Sources** entry holds one branch per system, so a reader can ask what they
have from a given platform; issues sit under the system that raises them,
beside the repositories they are raised against; and a system that was never
connected is listed saying so, because "not connected" and "connected but
empty" both used to read as a zero while calling for completely different next
moves. That leaves **Connections** holding the spaces tagged alongside this one,
which is what the section now says it holds. Meetings takes the place of Standup
on the new rail, leading to the series a space listens to and what came of each
call, described in the words a reader would ask the question in; the standup view
and its links still work.

Settings grew a second level: five groups over the eleven tabs that had
accumulated in one row, with a subtab per connector under Sources. Content
became somewhere to tidy the wiki, with four subtabs splitting settings from
actions, and the page tree there is tickable: a bar appears once something is
ticked, offering a move into any folder or out to the top level, and a delete
that names what it is about to remove rather than counting it. Ticks are kept
against the whole tree, so a tick made before a search was typed is still a
tick. The settings subtabs no longer outrank the tabs above them — the smaller
choice used to be a filled pill while the larger one was a bare underline — and
the dividing line now closes the top row so the subtabs fall on the content's
side of it, with the administration page sharing the same definition. Links that
leave a space's settings for the product's own open in a new tab, as the
external mark beside them always promised, instead of abandoning a half-filled
form.

The space header is thinner on the new navigation. Watching the whole space is
configuration and sits with the rest of it, watching a single page stays on that
page, and full screen is left to the browser. The header's one standing offer is
to bring the space up to date: the button is called **Run ingest** rather than
"Sync now", it is coloured like the Ask button it sits beside and at the same
size, it keeps a readable label while a run is going and reports whether that
run has started or is merely queued, it declines a second run, and it is not
shown at all to someone who cannot start one. An information button beside it
says which pages a run will rewrite and which it will leave alone, reachable by
keyboard as well as by pointer. Following the space sits next to it, because
that is where a reader decides whether they want to hear about the space in
front of them, even though it is configured elsewhere.

## The wiki and its editors

Every destination the navigation leads to is now headed the same way: one
heading at one size, an optional count or badge beside it, a sentence under it,
and the page's actions on the same row. Previously the wiki, the folder views,
the standup and the overview each named themselves differently or not at all, so
moving between them changed the size, weight and position of the title. The
create action is filled on every list page, and inside a folder it offers a new
page rather than a new subfolder.

A page's header says who wrote it in words that distinguish a person from the
agent — edited by someone, written by the agent, rewritten by an ingest, with a
person's last edit kept alongside when the agent has since written over it — and
it reads only live revisions, so a draft awaiting review can no longer be
credited for the live page. The kind badge is always visible, so a page that the
next ingest may overwrite says so. Pages are named without their file extension
everywhere a person reads them, the path fragment that repeated the title is
gone, and the author no longer wraps onto a line above their own sentence.

Naming and writing pages moved to where the pages are. A page is named while
being edited: a pencil in the editor turns the heading into a field, and what is
typed is saved by the same Save that saves the body, so abandoning the edit
abandons the name with it. Locked, read-only and mirrored pages are not offered
it. A page can also be renamed from a quiet menu on its own row in the tree,
hidden until the row is hovered or focused. Renaming changes the title that the
tree, the header and the breadcrumb all read, and leaves the underlying path
alone, so links already shared keep resolving and no filename ever reaches a
reader. The new-page field asks for a name in the page's own type rather than
offering a monospace filename with an extension, which used to teach readers
that pages are files.

A reader browsing the wiki can now do the whole job without leaving it. The Wiki
section header carries a quiet new-page button, a folder row can make a page
inside itself, and making a folder is back beside making a page at the head of
the section and on each folder's own row. Import, export and new folder are on
the Wiki view's own actions row where there is room for words; export is offered
to anyone who can read the wiki, since getting a copy out is not an edit, and
only once there is something to get out. Bulk reorganising stays in settings.

Custom prompts, which configure how a generated page gets written, read as a
header of the editor rather than a card beside it: inside the editing frame,
under the formatting bar, collapsed by default, capped when expanded so the
writing area keeps its room, with the name stacked over its purpose and the Save
button held out of the scroll. The editor's mode toggle moved into the
formatting bar. The reading-width toggle, the in-editor assist affordance and
the "not from a template" line are gone; pages keep the default column and notes
keep the full canvas. A note's header no longer shows its filename or a
redundant new-note line, and the export menu dropped its per-item descriptions.

The wiki gained a glossary of its own. The terms were always there, one page per
word, but they were filed among the mirrored sources where nobody looks up a
word. Glossary is now a row under Wiki, reading the terms as a glossary — the
word, what it stands for and the sentence defining it, alphabetically — with a
box to find one by its expansion or an alias. It is the only search box left in
TOME, because it is the one place a reader arrives already knowing the word they
want.

Content can be related across spaces by tagging. A whole page can be tagged from
the editor, or a single passage from a picker in the body, and the page then
appears under the tagged space's related content and is included in what that
space's agent is told. A tag is shown as the space's name rather than as its
stored identifier, and the wording asks a reader to connect a page to a space
rather than to "tag" it.

The issue board can be filtered by project, and no longer offers to add labels
from a surface meant for reading issues; the tracked labels that used to be
separate rail destinations are a chip row above the issues search, where
switching between them is one click. An empty wiki tree no longer offers to run
an ingest. Everywhere else that could be empty — folders, notes, ingest history,
page history, the dependency graph, the issue board, the meetings list and the
project list — now shares one illustrated empty state with one line for what is
missing, one for what would fill it, and a way to go and do that, including a
link out to the repository's own issue list where that is the real answer. And
what used to be called gists is called notes in every heading, button, dialog,
breadcrumb, tour step and error message a person reads.

## Notifications and following

Notifications previously amounted to a bell in the header. There is now a
notifications page with an **Inbox** of everything received, narrowed by status,
type, project or origin and grouped by date, source or type, and the mark that
flags a row needing attention sits at the row's right edge, level with the date,
with its slot held open on rows without one so a scan down the list finds every
one of them against a straight edge.

A **Watching** tab lays the whole goal, area and project tree out so a reader
can choose what reaches them, and each row can be delivered to a chat space or
as a direct message, either as changes happen or collected into a daily or
weekly digest at an hour in the reader's own timezone. Choosing to watch is only
a routing choice: read access is checked again at delivery, so a row can never
act as a grant. When saving a wiki edit, the author can control who hears about
it and mention people with a note, and unread pages are dotted in the page tree.

Following a space is one idea with one name. The space-level control used to say
Follow while the page-level one said Watch and the inbox called its tab
Watching; all of it is following now, with the same bell the rest of the
notification surfaces use. The binary toggle became a menu offering Everything,
Important, Mentions and Off, with a link to the full settings.

Notification preferences are reachable from where they are needed. The product's
own settings gained a Notifications tab covering whether to be told at all, what
about, where, how often and quiet hours, plus the same three choices per space
over the tree of what a reader follows, where setting a parent sets its branch
and a column reads "Mixed" rather than claiming one of its values when the rows
disagree. A space's own Notifications tab carries those controls directly, drawn
by the same component, instead of two paragraphs and a pair of links sending the
reader elsewhere to do the thing they opened the tab to do. Where a preference
is not yet acted on downstream, the panel says so rather than offering a Save
that would quietly do nothing.

The hub gained a **Digest** tab: a weekly read of the portfolio in prose, held
to a reading width so the text reaches the edge of its card instead of leaving a
third of it empty. Its Configure button opens a form in place of the digest and
asks three questions in the order a reader answers them — the subject first,
since it is the only one with no sensible default, then the schedule, then
delivery. The chat-delivery row is shown switched off, with a line saying it
cannot be used yet, rather than being left out; and "Connect Webex" is a real
link that opens the connections page in a new tab, so an unsaved digest or an
unsaved set of preferences is not lost on the way.

## The guided tours

A tour button sits on the catalogue, and it now asks which tour. One tour of the
whole product was the wrong shape, since most people arrive wanting one thing:
there are five walkthroughs, listed with what each covers, taking in getting
around the catalogue's several readings, writing a page, connecting spaces, the
agent and its chat configuration, and notifications.

The tours themselves became quicker and more reliable. They start promptly
rather than after half a dozen requests, and the chooser begins its work as it
opens, so picking a tour is usually all the wait there is. A step that explains
an idea rather than a control can now carry no anchor at all and is shown
immediately in the middle of the window, instead of waiting for a control that
does not exist. A step no longer appears on the wrong page and then moves. Steps
about a whole panel point at the tab that opens it, which is where a reader
would click anyway, and any anchor taller than the window has its top ringed and
brought to the top of the window rather than scrolling the reader into the
middle of a view they have not seen. When a tour needs to borrow a real page it
looks first at the space the reader is standing in, then the ones they follow,
then anything they can read, so a reader on their first day is no longer told
there is no page to show in a deployment full of them. A step with nothing to
point at dims the page rather than ringing something arbitrary.

## The agent and chat delivery

Where no agent is deployed, the corner of the hub used to be simply empty. It
now holds a stand-in that looks like the real thing and says outright that
nothing is being answered: the same launcher pill, the same translucent panel,
the same tabs, a sample exchange with timestamps, a short history of past
questions, and a composer — with everything that would do something visibly
switched off. It appears only where the real panel does not, so the two are
never stacked in one corner. Its colours were measured against what sits behind
them in both themes rather than assumed.

The panel stays with the reader. Opening it on the catalogue and following a
link into a space no longer loses it: its open state, tab, size and expansion
survive the move, though it does not open itself on a fresh load, and it stays
off the full chat view where a second chat in the corner of a chat would be two
chats in one place. In a space's settings it sits above the Save bar rather than
on it. It is resized from its own top and left edges, where the pointer changes
over the border; the ring handle that used to sit over the header is gone, as is
a tab that had nothing behind it. Its header carries three controls — an
overflow menu, the way out to the full chat, and close — with new chat, expand
and reset size moved into the menu.

A labelled button ahead of those controls opens a short note with the three
steps for reaching the agent from the chat client, including the bot's full
address rather than a search term that would also match whatever else a
workspace happens to call it. The note stays until it is closed on its own
cross, because a reader works through three steps while clicking around, and it
can be dragged off whatever it is covering. The same kind of note is offered
from the digest and notification settings where a chat connection is needed.

The agent is also told about pages that other spaces have tagged into this one.
They are given to it as their own section, separate from the space's own wiki
and from any child wikis it rolls up, each carrying the space that owns it, so
an answer drawn from one can attribute it correctly and a plain project is never
told that it spans more than it does.

## The platform shell

The welcome band greets the reader with the product's name and what it stands
for, rather than a stale default line the client and the server disagreed about.
The tabs moved out of the band and onto the page beneath it, so the band stays a
greeting rather than a container. Its three buttons — settings, the connection
instructions and the tour — share one definition of height, padding and type, so
they line up with each other and stand at the height of the tabs below them
instead of reading as small print to get past; the connection button sits beside
the tour. Behind the tabs, a soft two-colour wash in the corner the eye leaves
last gives them something to sit on, drawn in the product's own palette and held
still while a long list scrolls past.

An information mark beside the banner's title opens a note with the release, the
full build identifier and the build date, so a reader filing a bug can see and
copy what they were looking at. It is a note rather than a tooltip precisely
because these are things people copy out, and rows the build does not report are
left out rather than filled in with "unknown".

Two shared controls were corrected product-wide. Dropdowns draw their own arrow,
inset consistently instead of jammed against the border with the focus ring
tracing the radius behind it, which also removed two hand-rolled copies
elsewhere. And in the navigation, a selected row now reads more strongly than a
merely hovered one.
